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
import {
  APP_BUILD_NUMBER,
  APP_VERSION,
  DEV_RIDE_SIMULATOR_ENABLED,
} from '../config/runtimeEnvironment';
import { safeTrackingPayload, isRecentNativeLocationSample } from '../utils/rideTracking';
import { shouldPublishDriverLocation } from '../utils/driverLocationPolicy';
import { BACKGROUND_INCIDENT_REASONS } from '../utils/driverBackgroundReliability';
import { reportBackgroundIncident } from './driverBackgroundReliabilityStore';

export const DRIVER_LOCATION_TASK = 'drivelocal-driver-live-location-v1';
const SESSION_KEY = '@drivelocal/driver-location-session-v1';
const LAST_STATUS_KEY = '@drivelocal/driver-location-last-status-v1';
const DEV_OVERRIDE_KEY = '@drivelocal/driver-location-dev-override-v1';
const LAST_PUBLISH_KEY = '@drivelocal/driver-location-last-publish-v2';

// Native sampling is intentionally more frequent than Firestore publication.
// A time-driven online sample guarantees an idle-driver heartbeat in background;
// the pure policy still limits Firestore writes to one useful point/heartbeat.
const ONLINE_NATIVE_INTERVAL_MS = 60_000;
const ACTIVE_RIDE_NATIVE_INTERVAL_MS = 5_000;
const ONLINE_QUEUE_GAP_MS = 15_000;
const ACTIVE_RIDE_QUEUE_GAP_MS = 3_000;

let publishQueue = Promise.resolve();
let lastThrottleLogAtMs = 0;
const lastQueuedAtByMode = { online: 0, active_ride: 0 };

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function trackingMode(session) {
  return session?.rideId ? 'active_ride' : 'online';
}

function traceTracking(event, session = null, details = {}, level = 'log') {
  const payload = {
    scope: 'driver_location',
    event,
    mode: trackingMode(session),
    driverId: shortId(session?.driverId),
    availabilitySessionId: shortId(session?.availabilitySessionId),
    rideId: shortId(session?.rideId),
    rideStatus: session?.rideStatus || null,
    atMs: Date.now(),
    ...details,
  };
  const method = console[level] || console.log;
  method(`[DRIVER_LOCATION] ${event}`, payload);
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

function reportThrottle(mode, reason, session = null) {
  const nowMs = Date.now();
  // Throttling saves a Firestore write, not the session: renew presence anyway,
  // otherwise a stationary driver whose points are all throttled would age out
  // of dispatch while working.
  if (session) publishSessionHeartbeat(session).catch(() => undefined);
  if (nowMs - lastThrottleLogAtMs < 5_000) return;
  lastThrottleLogAtMs = nowMs;
  writeSafeStatus(`${mode}_throttled`, { reason }).catch(() => undefined);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    traceTracking('publish.throttled', session, { reason, result: 'skipped' });
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
    availabilityClientBuildNumber: APP_BUILD_NUMBER,
    availabilityClientVersion: APP_VERSION,
    availabilityClientSessionId: session.availabilitySessionId,
    availabilityClientUpdatedAtMs: nowMs,
    availabilityClientUpdatedAt: serverTimestamp(),
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

/**
 * Renews the work session WITHOUT a usable GPS point.
 *
 * availabilityUpdatedAt is what proves to dispatch that a driver is working, and
 * until now it was only ever written alongside a published position. A tunnel, a
 * covered parking, an indoor stop or simply a fix too poor to pass
 * safeTrackingPayload therefore froze the session, and after the server lease
 * the driver silently stopped receiving offers while his app still said
 * "disponível". Production incident 2026-09-05.
 *
 * Deliberately does NOT touch `location` or `locationUpdatedAt`: the last known
 * position stays as it was and keeps ageing, so dispatch still applies its own
 * freshness rules. This only says "the app is alive and this session is mine".
 *
 * @param {object} session local work session
 * @returns {Promise<boolean>} true when the heartbeat was written
 */
async function publishSessionHeartbeat(session) {
  const currentUid = await authenticatedUid();
  if (!currentUid || currentUid !== session?.driverId) return false;

  // Same guard as a position publish: a queued event from an ended session must
  // never revive it.
  const currentSession = await readSession();
  if (!sameSession(currentSession, session) || currentSession?.trackingPaused === true) {
    return false;
  }

  const nowMs = Date.now();
  try {
    await setDoc(
      doc(db, 'drivers', session.driverId),
      {
        availabilityClientBuildNumber: APP_BUILD_NUMBER,
        availabilityClientVersion: APP_VERSION,
        availabilityClientSessionId: session.availabilitySessionId,
        availabilityClientUpdatedAtMs: nowMs,
        availabilityClientUpdatedAt: serverTimestamp(),
        availabilityUpdatedAtMs: nowMs,
        availabilityUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    traceTracking('heartbeat.published', session, { result: 'session_renewed' });
    return true;
  } catch (error) {
    // Best effort: a failed heartbeat must never interrupt tracking. The next
    // native sample tries again.
    traceTracking('heartbeat.failed', session, {
      reason: error?.code || error?.message || 'unknown',
      result: 'session_not_renewed',
    }, 'warn');
    return false;
  }
}

async function publishLocationUnlocked(session, locationObject, { force = false } = {}) {
  const payload = isRecentNativeLocationSample(locationObject) ? safeTrackingPayload(locationObject) : null;
  const currentUid = await authenticatedUid();
  if (!payload || !currentUid || currentUid !== session?.driverId) {
    // Keep recovery alive without pretending that an unusable or old point is
    // fresh. Dispatch still applies its independent GPS deadline.
    if (!payload && currentUid && currentUid === session?.driverId) {
      await publishSessionHeartbeat(session);
    }
    traceTracking('publish.rejected', session, {
      reason: !payload ? 'invalid_payload' : !currentUid ? 'unauthenticated' : 'authenticated_driver_mismatch',
      result: 'dropped',
    }, 'warn');
    return false;
  }

  // A queued native point is allowed to finish only if the exact local work/ride
  // session still exists. Stopping work removes the session before stopping the
  // native task, so delayed events become harmless no-ops.
  const currentSession = await readSession();
  if (!sameSession(currentSession, session)) {
    await writeSafeStatus('stale_session_publish_dropped');
    traceTracking('publish.rejected', session, {
      reason: 'stale_local_session',
      currentSessionId: shortId(currentSession?.availabilitySessionId),
      result: 'dropped',
    });
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
    reportThrottle(mode, decision.reason, currentSession);
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
      traceTracking('driver_heartbeat.skipped_during_ride', currentSession, {
        reason: error?.code || error?.message || 'unknown',
        result: 'ride_location_preserved',
      }, 'warn');
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
  traceTracking('publish.succeeded', currentSession, {
    reason: decision.reason,
    policyMode: decision.mode,
    result: 'published',
  });
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
    reportThrottle(mode, 'queue_gap', session);
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
      traceTracking('background_task.failed', null, {
        reason: error?.message || 'missing_task_data',
        result: 'not_published',
      }, 'error');
      return;
    }

    try {
      const session = await readSession();
      const locations = Array.isArray(data.locations) ? data.locations : [];
      const latest = locations[locations.length - 1];
      if (!session || !latest || session.trackingPaused === true) {
        if (session?.trackingPaused === true) {
          traceTracking('background_task.skipped', session, { reason: 'tracking_paused' });
        }
        return;
      }
      await publishLocation(session, latest);
    } catch (taskError) {
      await writeSafeStatus('publish_error');
      traceTracking('background_task.failed', await readSession(), {
        reason: taskError?.code || taskError?.message || 'unknown',
        result: 'not_published',
      }, 'error');
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
    // Online waiting must be time-driven even when the vehicle is perfectly still.
    // Firestore publication remains distance/time throttled by driverLocationPolicy.
    distanceInterval: activeRide ? 10 : 0,
    deferredUpdatesInterval: intervalMs,
    deferredUpdatesDistance: activeRide ? 10 : 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: activeRide ? 'DriveLocal — corrida em andamento' : 'DriveLocal — sessão de trabalho',
      notificationBody: activeRide
        ? 'Sua posição está sendo compartilhada durante a corrida atual.'
        : 'Abra o app para conferir sua disponibilidade para novas corridas.',
      notificationColor: '#2563EB',
      killServiceOnDestroy: false,
    },
  });
  traceTracking('native_task.started', session, {
    intervalMs,
    distanceInterval: activeRide ? 10 : 0,
    result: 'active',
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

async function restorePreviousSessionAfterStartFailure(previousSession, failedSession) {
  if (
    !previousSession
    || previousSession.driverId !== failedSession.driverId
    || previousSession.availabilitySessionId !== failedSession.availabilitySessionId
  ) return false;

  try {
    await writeSession(previousSession);
    await ensureNativeTaskStarted(previousSession);
    await writeSafeStatus('session_start_previous_session_restored');
    traceTracking('session_start.rollback_succeeded', previousSession, {
      reason: 'previous_session_restored',
      result: 'restored',
    });
    return true;
  } catch (error) {
    traceTracking('session_start.rollback_failed', previousSession, {
      reason: error?.code || error?.message || 'unknown',
      result: 'stopped',
    }, 'error');
    return false;
  }
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
    traceTracking('session_start.rejected', {
      driverId,
      availabilitySessionId,
      rideId,
      rideStatus,
    }, { reason: 'invalid_session_identifiers', result: 'rejected' }, 'warn');
    return { status: 'invalid_session' };
  }

  const permission = requestPermissions
    ? await requestDriverTrackingPermissions()
    : await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') {
    traceTracking('session_start.rejected', {
      driverId,
      availabilitySessionId,
      rideId,
      rideStatus,
    }, { reason: permission.status, result: 'permission_missing' }, 'warn');
    return permission;
  }

  const previousSession = await readSession();
  const session = {
    driverId,
    availabilitySessionId,
    vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
    rideId,
    rideStatus: rideStatus || (rideId ? 'assigned' : null),
    trackingPaused: false,
    updatedAtMs: Date.now(),
  };

  traceTracking('session_start.started', session, {
    source: rideId ? 'active_ride' : 'work_session',
    requestPermissions,
  });

  try {
    await writeSession(session);

    const override = await readDevOverride();
    if (override && override.driverId === driverId && override.rideId === rideId) {
      await writeSafeStatus('dev_simulation_override_preserved');
      traceTracking('session_start.succeeded', session, {
        source: 'dev_simulation',
        result: 'active',
      });
      return { status: 'active', rideId, source: 'dev_simulation', availabilitySessionId };
    }

    await ensureNativeTaskStarted(session);
    const published = await publishImmediate(session, { force: true });
    if (!published) {
      const error = new Error('DRIVER_INITIAL_LOCATION_NOT_PUBLISHED');
      error.code = 'DRIVER_INITIAL_LOCATION_NOT_PUBLISHED';
      throw error;
    }

    await writeSafeStatus('session_start_succeeded', {
      rideId: rideId || null,
      availabilitySessionId: shortId(availabilitySessionId),
    });
    traceTracking('session_start.succeeded', session, {
      source: 'native',
      result: 'active',
    });
    return { status: 'active', rideId, source: 'native', availabilitySessionId };
  } catch (error) {
    const currentSession = await readSession();
    if (sameSession(currentSession, session)) await clearSession();
    await AsyncStorage.removeItem(LAST_PUBLISH_KEY);
    lastQueuedAtByMode[trackingMode(session)] = 0;
    await stopNativeTask().catch(() => undefined);

    const restored = await restorePreviousSessionAfterStartFailure(previousSession, session);
    if (!restored) {
      await clearSession().catch(() => undefined);
      await writeSafeStatus('session_start_failed', {
        reason: error?.code || error?.message || 'unknown',
      });
    }
    traceTracking('session_start.failed', session, {
      reason: error?.code || error?.message || 'unknown',
      rollback: restored ? 'previous_session_restored' : 'fully_stopped',
      result: 'error',
    }, 'error');
    throw error;
  }
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
  let workSessionId = availabilitySessionId || (
    existing?.driverId === driverId ? existing.availabilitySessionId : null
  );

  // A confirmed ride is recoverable even if AsyncStorage was cleared or the app
  // process was recreated. The acceptance transaction freezes the work-session id
  // on the ride, which is safer than inventing a new availability session mid-ride.
  if (!workSessionId && validIdentifier(rideId)) {
    const rideSnap = await getDoc(doc(db, 'rideRequests', rideId));
    const ride = rideSnap.exists() ? rideSnap.data() : null;
    if (
      ride?.acceptedDriverId === driverId
      && validIdentifier(ride?.acceptedAvailabilitySessionId)
    ) {
      workSessionId = ride.acceptedAvailabilitySessionId;
      traceTracking('active_ride.session_recovered', {
        driverId,
        availabilitySessionId: workSessionId,
        rideId,
        rideStatus,
      }, { source: 'ride_acceptance_snapshot', result: 'recovered' });
    }
  }

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
export async function refreshDriverOnlineHeartbeat({ force = false } = {}) {
  const session = await readSession();
  if (!session) return { status: 'no_session' };
  if (session.rideId || session.trackingPaused === true) return { status: 'active_ride_managed' };

  const currentUid = await authenticatedUid();
  if (!currentUid || currentUid !== session.driverId) {
    traceTracking('foreground_heartbeat.rejected', session, {
      reason: 'authenticated_driver_mismatch',
      result: 'not_published',
    }, 'warn');
    return { status: 'session_mismatch' };
  }

  const permission = await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') {
    traceTracking('foreground_heartbeat.rejected', session, {
      reason: permission.status,
      result: 'not_published',
    }, 'warn');
    return permission;
  }

  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (!started) {
    await ensureNativeTaskStarted(session);
    await writeSafeStatus('foreground_native_task_restarted');
    traceTracking('foreground_heartbeat.native_task_repaired', session, {
      reason: 'native_task_missing',
      result: 'restarted',
    });
    // Android stopped our service: count it so the cockpit can explain the
    // battery-optimization exemption instead of leaving the driver puzzled.
    await reportBackgroundIncident(
      BACKGROUND_INCIDENT_REASONS.NATIVE_TASK_REPAIRED
    ).catch(() => undefined);
  }

  const published = await publishImmediate(session, { force });
  // A heartbeat preserves recovery, but NEVER proves a usable GPS position.
  if (!published) await publishSessionHeartbeat(session);
  return { status: published ? 'published' : 'heartbeat_only' };
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
  traceTracking('dev_simulation.started', session, { result: 'active' });
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
      timestamp: Date.now(),
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
  traceTracking('dev_simulation.native_tracking_restored', session, { result: 'active' });
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
        traceTracking('active_ride.detached', session, {
          reason: 'payment_or_terminal_transition_pending',
          result: 'paused',
        });
        return { status: 'paused' };
      }
      await clearSession();
      await AsyncStorage.removeItem(LAST_PUBLISH_KEY);
      await writeSafeStatus('active_ride_detached_session_revoked');
      traceTracking('active_ride.detached', session, {
        reason: 'work_session_not_reusable',
        result: 'stopped',
      });
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
    traceTracking('active_ride.detached', onlineSession, {
      reason: 'work_session_still_valid',
      result: 'online_resumed',
    });
    return { status: 'active' };
  } catch (error) {
    await writeSafeStatus('active_ride_detach_reconciliation_failed');
    traceTracking('active_ride.detach_failed', session, {
      reason: error?.code || error?.message || 'unknown',
      result: 'paused',
    }, 'error');
    return { status: 'paused' };
  }
}

export async function stopDriverOnlineTracking() {
  const session = await readSession();
  traceTracking('tracking_stop.started', session, { result: 'stopping' });

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
  traceTracking('tracking_stop.succeeded', session, { result: 'stopped' });
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
    traceTracking('online_restore.rejected', {
      driverId,
      availabilitySessionId,
    }, {
      reason: !session ? 'local_session_missing' : 'local_session_mismatch',
      result: 'no_session',
    });
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
  traceTracking('active_ride.status_updated', next, { result: 'updated' });
  return { status: 'updated', rideStatus: next.rideStatus };
}

export async function getDriverTrackingSession() {
  return readSession();
}
