import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';
import { safeTrackingPayload } from '../utils/rideTracking';
import { shouldPublishDriverLocation } from '../utils/driverLocationPolicy';

export const DRIVER_LOCATION_TASK = 'drivelocal-driver-live-location-v1';
const SESSION_KEY = '@drivelocal/driver-location-session-v1';
const LAST_STATUS_KEY = '@drivelocal/driver-location-last-status-v1';
const DEV_OVERRIDE_KEY = '@drivelocal/driver-location-dev-override-v1';
const LAST_PUBLISH_KEY = '@drivelocal/driver-location-last-publish-v2';

// Native sampling is intentionally more frequent than Firestore publication.
// The pure policy decides whether the point carries useful new information.
const ONLINE_NATIVE_INTERVAL_MS = 30_000;
const ACTIVE_RIDE_NATIVE_INTERVAL_MS = 5_000;
const ONLINE_QUEUE_GAP_MS = 15_000;
const ACTIVE_RIDE_QUEUE_GAP_MS = 3_000;

let publishQueue = Promise.resolve();
let lastThrottleLogAtMs = 0;
const lastQueuedAtByMode = { online: 0, active_ride: 0 };

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function trackingMode(session) {
  return session?.rideId ? 'active_ride' : 'online';
}

function sessionIdentity(session) {
  if (!session) return null;
  return [
    session.driverId || '',
    session.availabilitySessionId || '',
    session.rideId || '',
  ].join('|');
}

function sameSession(a, b) {
  return Boolean(sessionIdentity(a) && sessionIdentity(a) === sessionIdentity(b));
}

async function readSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!validIdentifier(parsed?.driverId)) return null;
    if (!validIdentifier(parsed?.availabilitySessionId)) return null;
    if (parsed.rideId != null && !validIdentifier(parsed.rideId)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

async function writeSession(session) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

async function readLastPublish() {
  try {
    const raw = await AsyncStorage.getItem(LAST_PUBLISH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Number.isFinite(Number(parsed?.atMs)) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

async function writeLastPublish({ session, payload, atMs, mode }) {
  await AsyncStorage.setItem(
    LAST_PUBLISH_KEY,
    JSON.stringify({
      driverId: session.driverId,
      availabilitySessionId: session.availabilitySessionId,
      rideId: session.rideId || null,
      rideStatus: session.rideStatus || null,
      location: payload.location,
      speedMps: payload.speedMps,
      atMs,
      mode,
    })
  );
}

async function readDevOverride() {
  if (!DEV_RIDE_SIMULATOR_ENABLED) return null;
  try {
    const raw = await AsyncStorage.getItem(DEV_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!validIdentifier(parsed?.driverId) || !validIdentifier(parsed?.rideId)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

async function writeDevOverride({ driverId, rideId }) {
  await AsyncStorage.setItem(
    DEV_OVERRIDE_KEY,
    JSON.stringify({ driverId, rideId, atMs: Date.now() })
  );
}

async function clearDevOverride() {
  await AsyncStorage.removeItem(DEV_OVERRIDE_KEY);
}

async function writeSafeStatus(status, details = {}) {
  try {
    await AsyncStorage.setItem(
      LAST_STATUS_KEY,
      JSON.stringify({ status, atMs: Date.now(), ...details })
    );
  } catch (_error) {
    // Diagnostic persistence must never stop tracking.
  }
}

async function authenticatedUid() {
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }
  return auth.currentUser?.uid || null;
}

function reportThrottle(mode, reason) {
  const nowMs = Date.now();
  if (nowMs - lastThrottleLogAtMs < 5_000) return;
  lastThrottleLogAtMs = nowMs;
  writeSafeStatus(`${mode}_throttled`, { reason }).catch(() => undefined);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[DRIVER_LOCATION] throttled mode=${mode} reason=${reason}`);
  }
}

function driverLocationUpdate(session, payload, nowMs) {
  return {
    location: payload.location,
    locationAccuracyMeters: payload.accuracyMeters,
    locationHeadingDegrees: payload.headingDegrees,
    locationSpeedMps: payload.speedMps,
    locationUpdatedAtMs: nowMs,
    locationUpdatedAt: serverTimestamp(),
    locationAvailabilitySessionId: session.availabilitySessionId,
    availabilityUpdatedAtMs: nowMs,
    availabilityUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function publishRideLocation(session, payload, nowMs) {
  await setDoc(
    doc(db, 'activeRideLocations', session.rideId),
    {
      rideId: session.rideId,
      driverId: session.driverId,
      vehicleType: session.vehicleType === 'moto' ? 'moto' : 'car',
      ...payload,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function publishLocationUnlocked(session, locationObject, { force = false } = {}) {
  const payload = safeTrackingPayload(locationObject);
  const currentUid = await authenticatedUid();
  if (!payload || !currentUid || currentUid !== session?.driverId) return false;

  // A queued native point is allowed to finish only if the exact local work/ride
  // session still exists. Stopping work removes the session before stopping the
  // native task, so delayed events become harmless no-ops.
  const currentSession = await readSession();
  if (!sameSession(currentSession, session)) {
    await writeSafeStatus('stale_session_publish_dropped');
    return false;
  }

  const nowMs = Date.now();
  const lastPublish = await readLastPublish();
  const decision = shouldPublishDriverLocation({
    session: currentSession,
    payload,
    lastPublish,
    nowMs,
    force,
  });
  const mode = trackingMode(currentSession);
  if (!decision.publish) {
    reportThrottle(mode, decision.reason);
    return false;
  }

  const driverUpdate = driverLocationUpdate(currentSession, payload, nowMs);

  if (currentSession.rideId) {
    // The passenger-facing ride point is the critical write. A moderation action
    // may revoke the normal work session during an active ride; that must not cut
    // the already-assigned passenger's live tracking.
    await publishRideLocation(currentSession, payload, nowMs);
    try {
      await updateDoc(doc(db, 'drivers', currentUid), driverUpdate);
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log(
          '[DRIVER_LOCATION] driver heartbeat skipped during active ride',
          error?.code || error?.message || 'unknown'
        );
      }
    }
  } else {
    await updateDoc(doc(db, 'drivers', currentUid), driverUpdate);
  }

  await writeLastPublish({
    session: currentSession,
    payload,
    atMs: nowMs,
    mode: decision.mode,
  });
  await writeSafeStatus(currentSession.rideId ? 'active_ride_published' : 'online_published', {
    reason: decision.reason,
    policyMode: decision.mode,
  });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(
      `[DRIVER_LOCATION] published mode=${decision.mode} reason=${decision.reason} atMs=${nowMs}`
    );
  }
  return true;
}

function publishLocation(session, locationObject, options = {}) {
  const mode = trackingMode(session);
  const nowMs = Date.now();
  const force = options?.force === true;
  const queueGapMs = session?.rideId ? ACTIVE_RIDE_QUEUE_GAP_MS : ONLINE_QUEUE_GAP_MS;

  // Fast guard for Android batch replays. The detailed distance/time decision runs
  // once the selected event reaches the serialized queue.
  if (!force && nowMs - lastQueuedAtByMode[mode] < queueGapMs) {
    reportThrottle(mode, 'queue_gap');
    return Promise.resolve(false);
  }
  lastQueuedAtByMode[mode] = nowMs;

  const run = publishQueue.then(() => publishLocationUnlocked(session, locationObject, options));
  publishQueue = run.catch(() => undefined);
  return run;
}

if (!TaskManager.isTaskDefined(DRIVER_LOCATION_TASK)) {
  TaskManager.defineTask(DRIVER_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data) {
      await writeSafeStatus('task_error');
      return;
    }

    try {
      const session = await readSession();
      const locations = Array.isArray(data.locations) ? data.locations : [];
      const latest = locations[locations.length - 1];
      if (!session || !latest || session.trackingPaused === true) return;
      await publishLocation(session, latest);
    } catch (taskError) {
      await writeSafeStatus('publish_error');
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log(
          '[DRIVER_LOCATION] background publish error',
          taskError?.code || taskError?.message || 'unknown'
        );
      }
    }
  });
}

export async function getDriverTrackingPermissionState() {
  if (Platform.OS !== 'android') return { status: 'unsupported' };
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return { status: 'services_disabled' };

  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  if (foreground.status !== 'granted') return { status: 'foreground_required' };
  if (background.status !== 'granted') return { status: 'background_required' };
  return { status: 'granted' };
}

export async function requestDriverTrackingPermissions() {
  if (Platform.OS !== 'android') return { status: 'unsupported' };
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return { status: 'services_disabled' };

  let foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    foreground = await Location.requestForegroundPermissionsAsync();
  }
  if (foreground.status !== 'granted') {
    return { status: 'foreground_denied', canAskAgain: foreground.canAskAgain };
  }

  let background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    background = await Location.requestBackgroundPermissionsAsync();
  }
  if (background.status !== 'granted') {
    return { status: 'background_denied', canAskAgain: background.canAskAgain };
  }

  return { status: 'granted' };
}

async function stopNativeTask() {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
}

async function ensureNativeTaskStarted(session) {
  await stopNativeTask();

  const activeRide = Boolean(session?.rideId);
  const intervalMs = activeRide ? ACTIVE_RIDE_NATIVE_INTERVAL_MS : ONLINE_NATIVE_INTERVAL_MS;
  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: activeRide ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: intervalMs,
    distanceInterval: activeRide ? 10 : 25,
    deferredUpdatesInterval: intervalMs,
    deferredUpdatesDistance: activeRide ? 10 : 25,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'DriveLocal — localização ativa',
      notificationBody: activeRide
        ? 'Sua posição está sendo compartilhada durante a corrida atual.'
        : 'Sua posição está sendo usada para encontrar corridas próximas.',
      notificationColor: '#2563EB',
      killServiceOnDestroy: false,
    },
  });
}

async function publishImmediate(session, options) {
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 30_000,
    requiredAccuracy: 100,
  });
  const current = lastKnown || await Location.getCurrentPositionAsync({
    accuracy: session?.rideId ? Location.Accuracy.High : Location.Accuracy.Balanced,
  });
  return publishLocation(session, current, options);
}

async function startSession({
  driverId,
  vehicleType,
  availabilitySessionId,
  rideId = null,
  rideStatus = null,
  requestPermissions = false,
}) {
  if (
    !validIdentifier(driverId)
    || !validIdentifier(availabilitySessionId)
    || (rideId != null && !validIdentifier(rideId))
  ) {
    return { status: 'invalid_session' };
  }

  const permission = requestPermissions
    ? await requestDriverTrackingPermissions()
    : await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') return permission;

  const session = {
    driverId,
    availabilitySessionId,
    vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
    rideId,
    rideStatus: rideStatus || (rideId ? 'assigned' : null),
    trackingPaused: false,
    updatedAtMs: Date.now(),
  };
  await writeSession(session);

  const override = await readDevOverride();
  if (override && override.driverId === driverId && override.rideId === rideId) {
    await writeSafeStatus('dev_simulation_override_preserved');
    return { status: 'active', rideId, source: 'dev_simulation', availabilitySessionId };
  }

  await ensureNativeTaskStarted(session);
  await publishImmediate(session, { force: true });
  return { status: 'active', rideId, source: 'native', availabilitySessionId };
}

export function startDriverOnlineTracking({
  driverId,
  vehicleType,
  availabilitySessionId,
  requestPermissions = false,
}) {
  return startSession({
    driverId,
    vehicleType,
    availabilitySessionId,
    rideId: null,
    requestPermissions,
  });
}

export async function attachActiveRideTracking({
  driverId,
  vehicleType,
  availabilitySessionId = null,
  rideId,
  rideStatus = 'assigned',
  requestPermissions = false,
}) {
  const existing = await readSession();
  const workSessionId = availabilitySessionId || (
    existing?.driverId === driverId ? existing.availabilitySessionId : null
  );
  return startSession({
    driverId,
    vehicleType,
    availabilitySessionId: workSessionId,
    rideId,
    rideStatus,
    requestPermissions,
  });
}

// Foreground safety net. The native background task remains primary, but this
// pulse repairs a stopped task and refreshes the lease only when the adaptive
// policy says a heartbeat is due.
export async function refreshDriverOnlineHeartbeat() {
  const session = await readSession();
  if (!session) return { status: 'no_session' };
  if (session.rideId || session.trackingPaused === true) return { status: 'active_ride_managed' };

  const currentUid = await authenticatedUid();
  if (!currentUid || currentUid !== session.driverId) {
    return { status: 'session_mismatch' };
  }

  const permission = await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') return permission;

  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (!started) {
    await ensureNativeTaskStarted(session);
    await writeSafeStatus('foreground_native_task_restarted');
  }

  const published = await publishImmediate(session, { force: false });
  return { status: published ? 'published' : 'throttled' };
}

export async function beginDevLocationSimulation({ driverId, vehicleType, rideId }) {
  if (!DEV_RIDE_SIMULATOR_ENABLED) {
    return { status: 'disabled', errorCode: 'DEV_SIMULATOR_DISABLED' };
  }
  if (!validIdentifier(driverId) || !validIdentifier(rideId)) {
    return { status: 'error', errorCode: 'DEV_SIMULATION_INVALID_SESSION' };
  }

  const currentUid = await authenticatedUid();
  const session = await readSession();
  if (!currentUid || currentUid !== driverId || session?.driverId !== driverId || session?.rideId !== rideId) {
    return { status: 'error', errorCode: 'DEV_SIMULATION_SESSION_MISMATCH' };
  }

  await stopNativeTask();
  await writeSession({
    ...session,
    vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
    trackingPaused: false,
    updatedAtMs: Date.now(),
  });
  await writeDevOverride({ driverId, rideId });
  await writeSafeStatus('dev_simulation_override_active');
  return { status: 'active', source: 'dev_simulation' };
}

export async function publishDevSimulatedLocation({ driverId, vehicleType, rideId, point }) {
  if (!DEV_RIDE_SIMULATOR_ENABLED) {
    return { status: 'disabled', errorCode: 'DEV_SIMULATOR_DISABLED' };
  }

  const override = await readDevOverride();
  const session = await readSession();
  if (
    !override
    || override.driverId !== driverId
    || override.rideId !== rideId
    || session?.driverId !== driverId
    || session?.rideId !== rideId
  ) {
    return { status: 'error', errorCode: 'DEV_SIMULATION_OVERRIDE_MISSING' };
  }

  const published = await publishLocation(
    { ...session, vehicleType: vehicleType === 'moto' ? 'moto' : 'car' },
    {
      coords: {
        latitude: point?.lat,
        longitude: point?.lng,
        accuracy: 5,
        heading: null,
        speed: 6,
      },
    },
    { force: true }
  );
  return published
    ? { status: 'published' }
    : { status: 'error', errorCode: 'DEV_SIMULATION_LOCATION_REJECTED' };
}

export async function restoreRealDriverTrackingAfterSimulation() {
  if (!DEV_RIDE_SIMULATOR_ENABLED) {
    return { status: 'disabled', errorCode: 'DEV_SIMULATOR_DISABLED' };
  }

  const session = await readSession();
  await clearDevOverride();
  if (!session) return { status: 'no_session' };
  if (session.trackingPaused === true) return { status: 'paused' };

  const permission = await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') return permission;
  await ensureNativeTaskStarted(session);
  await publishImmediate(session, { force: true });
  await writeSafeStatus('dev_simulation_native_tracking_restored');
  return { status: 'active', rideId: session.rideId || null, source: 'native' };
}

export async function detachActiveRideTracking(rideId) {
  const session = await readSession();
  if (validIdentifier(rideId)) {
    try {
      await deleteDoc(doc(db, 'activeRideLocations', rideId));
    } catch (_error) {
      // Backend lifecycle also removes this document. Client cleanup is best-effort.
    }
  }

  const override = await readDevOverride();
  if (override?.rideId === rideId) await clearDevOverride();
  if (!session || session.rideId !== rideId) return { status: 'no_session' };

  await stopNativeTask();
  const pausedSession = {
    ...session,
    trackingPaused: true,
    updatedAtMs: Date.now(),
  };
  await writeSession(pausedSession);

  try {
    const driverSnap = await getDoc(doc(db, 'drivers', session.driverId));
    const driver = driverSnap.exists() ? driverSnap.data() : null;
    const canResumeOnline = driver?.activeRideId == null
      && driver?.availabilityStatus === 'online'
      && driver?.availabilitySessionId === session.availabilitySessionId;

    if (!canResumeOnline) {
      if (driver?.activeRideId) {
        await writeSafeStatus('active_ride_tracking_paused_for_payment');
        return { status: 'paused' };
      }
      await clearSession();
      await AsyncStorage.removeItem(LAST_PUBLISH_KEY);
      await writeSafeStatus('active_ride_detached_session_revoked');
      return { status: 'stopped' };
    }

    const onlineSession = {
      ...session,
      rideId: null,
      rideStatus: null,
      trackingPaused: false,
      updatedAtMs: Date.now(),
    };
    await writeSession(onlineSession);
    await ensureNativeTaskStarted(onlineSession);
    await publishImmediate(onlineSession, { force: true });
    await writeSafeStatus('active_ride_detached_online_resumed');
    return { status: 'active' };
  } catch (_error) {
    await writeSafeStatus('active_ride_detach_reconciliation_failed');
    return { status: 'paused' };
  }
}

export async function stopDriverOnlineTracking() {
  const session = await readSession();

  // Invalidate the local session first. Any publication already waiting in the
  // queue re-reads AsyncStorage and drops itself before touching Firestore.
  await clearSession();
  await AsyncStorage.removeItem(LAST_PUBLISH_KEY);
  lastQueuedAtByMode.online = 0;
  lastQueuedAtByMode.active_ride = 0;
  await clearDevOverride();

  if (session?.rideId) {
    try {
      await deleteDoc(doc(db, 'activeRideLocations', session.rideId));
    } catch (_error) {
      // Best-effort client cleanup; terminal backend transitions also delete it.
    }
  }

  await stopNativeTask();
  await writeSafeStatus('stopped');
}

export async function restoreDriverOnlineTracking({
  driverId,
  vehicleType,
  availabilitySessionId,
}) {
  const session = await readSession();
  if (
    !session
    || session.driverId !== driverId
    || session.availabilitySessionId !== availabilitySessionId
  ) {
    return { status: 'no_session' };
  }
  return startSession({
    driverId,
    vehicleType: vehicleType || session.vehicleType,
    availabilitySessionId,
    rideId: session.rideId || null,
    rideStatus: session.rideStatus || null,
    requestPermissions: false,
  });
}

export async function updateActiveRideTrackingStatus(rideStatus) {
  const session = await readSession();
  if (!session?.rideId) return { status: 'no_active_ride' };
  const next = {
    ...session,
    rideStatus: rideStatus || session.rideStatus || 'assigned',
    updatedAtMs: Date.now(),
  };
  await writeSession(next);
  return { status: 'updated', rideStatus: next.rideStatus };
}

export async function getDriverTrackingSession() {
  return readSession();
}
