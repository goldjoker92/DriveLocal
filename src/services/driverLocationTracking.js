import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';
import { safeTrackingPayload } from '../utils/rideTracking';

export const DRIVER_LOCATION_TASK = 'drivelocal-driver-live-location-v1';
const SESSION_KEY = '@drivelocal/driver-location-session-v1';
const LAST_STATUS_KEY = '@drivelocal/driver-location-last-status-v1';
const DEV_OVERRIDE_KEY = '@drivelocal/driver-location-dev-override-v1';
const LAST_PUBLISH_KEY = '@drivelocal/driver-location-last-publish-v1';

// Backend dispatch accepts a fresh point for five minutes. Native updates remain
// more frequent so a working driver stays fresh, while the guards below prevent
// Android from replaying a queued batch as hundreds of Firestore writes.
const ONLINE_HEARTBEAT_INTERVAL_MS = 30_000;
const ACTIVE_RIDE_INTERVAL_MS = 5_000;
const ONLINE_MIN_PUBLISH_GAP_MS = 20_000;
const ACTIVE_RIDE_MIN_PUBLISH_GAP_MS = 3_000;

let publishQueue = Promise.resolve();
let lastThrottleLogAtMs = 0;
const lastQueuedAtByMode = { online: 0, active_ride: 0 };

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function trackingMode(session) {
  return session?.rideId ? 'active_ride' : 'online';
}

function minimumPublishGapMs(session) {
  return session?.rideId ? ACTIVE_RIDE_MIN_PUBLISH_GAP_MS : ONLINE_MIN_PUBLISH_GAP_MS;
}

async function readSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!validIdentifier(parsed?.driverId)) return null;
    if (parsed.rideId != null && !validIdentifier(parsed.rideId)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

async function writeSession(session) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
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

async function writeLastPublish({ driverId, rideId, atMs }) {
  await AsyncStorage.setItem(
    LAST_PUBLISH_KEY,
    JSON.stringify({ driverId, rideId: rideId || null, atMs })
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

async function writeSafeStatus(status) {
  try {
    await AsyncStorage.setItem(
      LAST_STATUS_KEY,
      JSON.stringify({ status, atMs: Date.now() })
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

function samePublishMode(last, session, currentUid) {
  return last?.driverId === currentUid
    && (last?.rideId || null) === (session?.rideId || null);
}

function reportThrottle(mode, minGapMs) {
  const nowMs = Date.now();
  if (nowMs - lastThrottleLogAtMs < 5_000) return;
  lastThrottleLogAtMs = nowMs;
  writeSafeStatus(`${mode}_throttled`).catch(() => undefined);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[DRIVER_LOCATION] burst throttled mode=${mode} minGapMs=${minGapMs}`);
  }
}

async function publishLocationUnlocked(session, locationObject, { force = false } = {}) {
  const payload = safeTrackingPayload(locationObject);
  const currentUid = await authenticatedUid();
  if (!payload || !currentUid || currentUid !== session?.driverId) return false;

  const nowMs = Date.now();
  const mode = trackingMode(session);
  const minGapMs = minimumPublishGapMs(session);
  const last = await readLastPublish();

  // Persisted guard survives JS/headless restarts. The in-memory guard in
  // publishLocation() rejects most burst events before they even join the queue.
  if (
    !force
    && samePublishMode(last, session, currentUid)
    && nowMs - Number(last.atMs) < minGapMs
  ) {
    reportThrottle(mode, minGapMs);
    return false;
  }

  const driverUpdate = {
    location: payload.location,
    locationAccuracyMeters: payload.accuracyMeters,
    locationHeadingDegrees: payload.headingDegrees,
    locationSpeedMps: payload.speedMps,
    locationUpdatedAtMs: nowMs,
    locationUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await updateDoc(doc(db, 'drivers', currentUid), driverUpdate);

  if (session.rideId) {
    await setDoc(
      doc(db, 'activeRideLocations', session.rideId),
      {
        rideId: session.rideId,
        driverId: currentUid,
        vehicleType: session.vehicleType === 'moto' ? 'moto' : 'car',
        ...payload,
        updatedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await writeLastPublish({
    driverId: currentUid,
    rideId: session.rideId || null,
    atMs: nowMs,
  });
  await writeSafeStatus(session.rideId ? 'active_ride_published' : 'online_published');
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[DRIVER_LOCATION] published mode=${mode} atMs=${nowMs}`);
  }
  return true;
}

function publishLocation(session, locationObject, options = {}) {
  const mode = trackingMode(session);
  const minGapMs = minimumPublishGapMs(session);
  const nowMs = Date.now();
  const force = options?.force === true;

  // Fast in-memory gate: a 160-event Android replay becomes one queued operation,
  // rather than 160 AsyncStorage reads followed by 159 rejected Firestore writes.
  if (!force && nowMs - lastQueuedAtByMode[mode] < minGapMs) {
    reportThrottle(mode, minGapMs);
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
      if (!session || !latest) return;
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

async function ensureNativeTaskStarted(rideId = null) {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }

  const intervalMs = rideId ? ACTIVE_RIDE_INTERVAL_MS : ONLINE_HEARTBEAT_INTERVAL_MS;
  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: intervalMs,
    distanceInterval: 0,
    deferredUpdatesInterval: intervalMs,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'DriveLocal — localização ativa',
      notificationBody: 'Sua posição está sendo usada para o despacho e para a corrida atual.',
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
    accuracy: Location.Accuracy.High,
  });
  return publishLocation(session, current, options);
}

async function startSession({ driverId, vehicleType, rideId = null, requestPermissions = false }) {
  if (!validIdentifier(driverId) || (rideId != null && !validIdentifier(rideId))) {
    return { status: 'invalid_session' };
  }

  const permission = requestPermissions
    ? await requestDriverTrackingPermissions()
    : await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') return permission;

  const session = {
    driverId,
    vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
    rideId,
    updatedAtMs: Date.now(),
  };
  await writeSession(session);

  const override = await readDevOverride();
  if (override && override.driverId === driverId && override.rideId === rideId) {
    await writeSafeStatus('dev_simulation_override_preserved');
    return { status: 'active', rideId, source: 'dev_simulation' };
  }

  await ensureNativeTaskStarted(rideId);
  await publishImmediate(session, { force: true });
  return { status: 'active', rideId, source: 'native' };
}

export function startDriverOnlineTracking({ driverId, vehicleType, requestPermissions = false }) {
  return startSession({ driverId, vehicleType, rideId: null, requestPermissions });
}

export async function attachActiveRideTracking({ driverId, vehicleType, rideId, requestPermissions = false }) {
  return startSession({ driverId, vehicleType, rideId, requestPermissions });
}

// Foreground safety net. The native background task remains primary, but this
// pulse repairs a stopped task and refreshes the last-known point while any
// driver screen is open. The write throttle makes duplicate pulses inexpensive.
export async function refreshDriverOnlineHeartbeat() {
  const session = await readSession();
  if (!session) return { status: 'no_session' };
  if (session.rideId) return { status: 'active_ride_managed' };

  const currentUid = await authenticatedUid();
  if (!currentUid || currentUid !== session.driverId) {
    return { status: 'session_mismatch' };
  }

  const permission = await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') return permission;

  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (!started) {
    await ensureNativeTaskStarted(null);
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

  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  await writeSession({
    ...session,
    vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
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

  const permission = await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') return permission;
  await ensureNativeTaskStarted(session.rideId || null);
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
  if (!session || session.rideId !== rideId) return;

  const onlineSession = { ...session, rideId: null, updatedAtMs: Date.now() };
  await writeSession(onlineSession);
  await ensureNativeTaskStarted(null);
  await publishImmediate(onlineSession, { force: true });
  await writeSafeStatus('active_ride_detached');
}

export async function stopDriverOnlineTracking() {
  const session = await readSession();
  if (session?.rideId) {
    try {
      await deleteDoc(doc(db, 'activeRideLocations', session.rideId));
    } catch (_error) {
      // Best-effort client cleanup; terminal backend transitions also delete it.
    }
  }

  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  await AsyncStorage.removeItem(SESSION_KEY);
  await AsyncStorage.removeItem(LAST_PUBLISH_KEY);
  lastQueuedAtByMode.online = 0;
  lastQueuedAtByMode.active_ride = 0;
  await clearDevOverride();
  await writeSafeStatus('stopped');
}

export async function restoreDriverOnlineTracking({ driverId, vehicleType }) {
  const session = await readSession();
  if (!session || session.driverId !== driverId) return { status: 'no_session' };
  return startSession({
    driverId,
    vehicleType: vehicleType || session.vehicleType,
    rideId: session.rideId || null,
    requestPermissions: false,
  });
}

export async function getDriverTrackingSession() {
  return readSession();
}
