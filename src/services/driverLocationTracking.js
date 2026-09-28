import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
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
import { recordClientNonFatal } from './clientErrorReporter';

export const DRIVER_LOCATION_TASK = 'drivelocal-driver-live-location-v1';
const SESSION_KEY = '@drivelocal/driver-location-session-v1';
const LAST_STATUS_KEY = '@drivelocal/driver-location-last-status-v1';
const DEV_OVERRIDE_KEY = '@drivelocal/driver-location-dev-override-v1';
const LAST_PUBLISH_KEY = '@drivelocal/driver-location-last-publish-v2';
// Which cadence the running native service was started with ('online' or
// 'active_ride'). A ride session can be served by an online-cadence service
// (restart deferred while the app was in background); the supervisor upgrades
// it as soon as the app is in the foreground again.
const NATIVE_MODE_KEY = '@drivelocal/driver-location-native-mode-v1';

// Native sampling is intentionally more frequent than Firestore publication.
// A time-driven online sample guarantees an idle-driver heartbeat in background;
// the pure policy still limits Firestore writes to one useful point/heartbeat.
const ONLINE_NATIVE_INTERVAL_MS = 60_000;
const ACTIVE_RIDE_NATIVE_INTERVAL_MS = 5_000;
const ONLINE_QUEUE_GAP_MS = 15_000;
const ACTIVE_RIDE_QUEUE_GAP_MS = 3_000;

// Ride live location (field incident 2026-09-27: passengers cancelled because the
// car stayed frozen on their map and they concluded nobody was coming).
//  - A ride point is older than this for the supervisor: repair it. The accepted
//    policy publishes every 8-15 s, the passenger map flags 30 s as outdated.
const RIDE_PUBLISH_STALE_MS = 20_000;
//  - getCurrentPositionAsync can wait a long time for a first fix indoors; ride
//    repairs never pile up behind it. The online start path keeps its old wait.
const RIDE_IMMEDIATE_FIX_TIMEOUT_MS = 12_000;

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

async function readNativeMode() {
  try {
    return (await AsyncStorage.getItem(NATIVE_MODE_KEY)) || null;
  } catch (_error) {
    return null;
  }
}

function withTimeout(promise, timeoutMs, code) {
  if (!timeoutMs) return promise;
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Production visibility for ride tracking degradations. Development traces stay
// in the console; production gets ONE sanitized non-fatal report per ride and
// state through the existing reportClientErrorSecure channel. No coordinates,
// no raw ids (the sanitizer shortens rideRef).
const reportedRideIssues = new Set();
function reportRideTrackingIssue(session, status, reason) {
  if (!session?.rideId) return;
  const key = `${session.rideId}:${status}`;
  if (reportedRideIssues.has(key)) return;
  reportedRideIssues.add(key);
  const error = new Error(`RIDE_TRACKING_${String(status).toUpperCase()}: ${reason || 'unknown'}`);
  error.name = 'RideTrackingDegraded';
  recordClientNonFatal(error, {
    eventName: 'driver.ride_tracking.degraded',
    role: 'driver',
    rideId: session.rideId,
    route: '/active-ride',
    severity: 'warning',
  }).catch(() => undefined);
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
  await AsyncStorage.removeItem(NATIVE_MODE_KEY).catch(() => undefined);
}

async function ensureNativeTaskStarted(session) {
  await stopNativeTask();

  const activeRide = Boolean(session?.rideId);
  const intervalMs = activeRide ? ACTIVE_RIDE_NATIVE_INTERVAL_MS : ONLINE_NATIVE_INTERVAL_MS;
  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: activeRide ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: intervalMs,
    // Time-driven in BOTH modes, even when the vehicle is perfectly still: an
    // online driver needs his heartbeat, and a ride passenger must keep seeing a
    // fresh point at a traffic light or while the driver waits at the pickup
    // (a 10 m distance filter silenced stopped phones: field incident 2026-09-27).
    // Firestore publication remains distance/time throttled by driverLocationPolicy.
    distanceInterval: 0,
    deferredUpdatesInterval: intervalMs,
    deferredUpdatesDistance: 0,
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
  await AsyncStorage.setItem(NATIVE_MODE_KEY, activeRide ? 'active_ride' : 'online').catch(() => undefined);
  traceTracking('native_task.started', session, {
    intervalMs,
    distanceInterval: 0,
    result: 'active',
  });
}

async function publishImmediate(session, options, { timeoutMs = 0 } = {}) {
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 30_000,
    requiredAccuracy: 100,
  });
  const current = lastKnown || await withTimeout(
    Location.getCurrentPositionAsync({
      accuracy: session?.rideId ? Location.Accuracy.High : Location.Accuracy.Balanced,
    }),
    timeoutMs,
    'DRIVER_LOCATION_FIX_TIMEOUT'
  );
  return publishLocation(session, current, options);
}

// Ride mode never falls back to the online work session. That fallback was the
// root of the 2026-09-27 field incident: the online session keeps writing
// drivers/{id}.location but never activeRideLocations/{rideId}, and nothing
// retried, so the passenger watched a frozen car for the whole approach.
// The ride session stays written: any running native task (even one still on the
// online cadence) now publishes ride points, and superviseActiveRideTracking()
// keeps repairing until a point is published.
async function keepRideSessionAfterStartFailure(session, reason) {
  await writeSession(session).catch(() => undefined);
  const nativeStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)
    .catch(() => false);
  const status = nativeStarted ? 'waiting_gps' : 'service_not_started';
  await writeSafeStatus('active_ride_start_degraded', { reason, nativeStarted });
  traceTracking('active_ride.start_degraded', session, {
    reason,
    nativeStarted,
    result: 'ride_session_kept',
  }, 'warn');
  reportRideTrackingIssue(session, status, reason);
  return {
    status,
    rideId: session.rideId,
    source: 'native',
    availabilitySessionId: session.availabilitySessionId,
    reason,
  };
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

  if (rideId) rideStartInFlight = true;
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

    const nativeRunning = rideId
      ? await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK).catch(() => false)
      : false;
    if (rideId && nativeRunning && AppState.currentState !== 'active') {
      // Android 12+ may refuse to START a foreground service from background.
      // Never stop a running service we might not be allowed to restart: it
      // already publishes ride points for the ride session written above, and
      // the supervisor upgrades its cadence once the app is foreground again.
      traceTracking('native_task.restart_deferred', session, {
        reason: 'app_not_foreground',
        result: 'running_task_kept',
      });
    } else {
      await ensureNativeTaskStarted(session);
    }
    const published = await publishImmediate(
      session,
      { force: true },
      { timeoutMs: rideId ? RIDE_IMMEDIATE_FIX_TIMEOUT_MS : 0 }
    );
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
    if (rideId) return keepRideSessionAfterStartFailure(session, error?.code || error?.message || 'unknown');

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
  } finally {
    // Always released, success or failure: a stuck flag would silence the
    // supervisor for every later ride.
    if (rideId) rideStartInFlight = false;
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

  // Same ride, stage change (assigned -> driver_arrived -> in_progress): keep the
  // running service. Restarting it at each stage was a window where Android could
  // refuse the restart and leave the passenger without any point. The manual
  // "Ativar" button (requestPermissions) still forces a full restart.
  if (
    !requestPermissions
    && existing?.driverId === driverId
    && existing?.rideId === rideId
    && existing?.trackingPaused !== true
    && validIdentifier(existing?.availabilitySessionId)
    && (!availabilitySessionId || availabilitySessionId === existing.availabilitySessionId)
  ) {
    const override = await readDevOverride();
    const nativeMode = await readNativeMode();
    const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)
      .catch(() => false);
    if (!override && started && nativeMode === 'active_ride') {
      await writeSession({ ...existing, rideStatus: rideStatus || existing.rideStatus, updatedAtMs: Date.now() });
      traceTracking('active_ride.stage_changed', { ...existing, rideStatus }, {
        result: 'native_task_reused',
      });
      return superviseActiveRideTracking({ reason: 'stage_changed' });
    }
  }

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

// Ride safety net, driven by the active-ride screen (10 s) and the driver layout
// pulse (60 s). The native task stays primary; this only repairs:
//  1. native service stopped, or still on the online cadence -> restart it in
//     ride mode, foreground only (Android may refuse a background start);
//  2. no ride point published for RIDE_PUBLISH_STALE_MS -> publish one now.
// It never falls back to the online session and never touches a DEV simulation.
// Concurrent callers share one run.
let superviseInFlight = null;
// A ride start is running (it stops/starts the native service and may wait for a
// first fix): the supervisor must not start a second one in parallel.
let rideStartInFlight = false;
export function superviseActiveRideTracking({ reason = 'pulse' } = {}) {
  if (superviseInFlight) return superviseInFlight;
  superviseInFlight = superviseActiveRideTrackingUnlocked(reason)
    .catch((error) => {
      traceTracking('active_ride.supervisor_failed', null, {
        reason: error?.code || error?.message || 'unknown',
        trigger: reason,
        result: 'error',
      }, 'warn');
      return { status: 'waiting_gps', reason: error?.code || 'unknown' };
    })
    .finally(() => { superviseInFlight = null; });
  return superviseInFlight;
}

async function superviseActiveRideTrackingUnlocked(trigger) {
  if (rideStartInFlight) return { status: 'checking' };
  const session = await readSession();
  if (!session?.rideId || session.trackingPaused === true) return { status: 'no_ride_session' };

  const override = await readDevOverride();
  if (override && override.driverId === session.driverId && override.rideId === session.rideId) {
    return { status: 'active', source: 'dev_simulation' };
  }

  const currentUid = await authenticatedUid();
  if (!currentUid || currentUid !== session.driverId) return { status: 'session_mismatch' };

  const permission = await getDriverTrackingPermissionState();
  if (permission.status !== 'granted') {
    traceTracking('active_ride.supervisor_blocked', session, {
      reason: permission.status,
      trigger,
      result: 'permission_missing',
    }, 'warn');
    reportRideTrackingIssue(session, permission.status, 'permission');
    return permission;
  }

  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  const nativeMode = await readNativeMode();
  if (!started || nativeMode !== 'active_ride') {
    if (AppState.currentState === 'active') {
      await ensureNativeTaskStarted(session);
      await writeSafeStatus('active_ride_native_task_repaired', { wasStarted: started });
      traceTracking('active_ride.native_task_repaired', session, {
        reason: started ? 'online_cadence' : 'native_task_missing',
        trigger,
        result: 'restarted',
      });
      if (!started) {
        await reportBackgroundIncident(BACKGROUND_INCIDENT_REASONS.NATIVE_TASK_REPAIRED)
          .catch(() => undefined);
      }
    } else if (!started) {
      traceTracking('active_ride.native_task_repair_deferred', session, {
        reason: 'app_not_foreground',
        trigger,
        result: 'waiting_foreground',
      }, 'warn');
      reportRideTrackingIssue(session, 'service_not_started', 'background');
      return { status: 'service_not_started' };
    }
  }

  const last = await readLastPublish();
  const lastRideMs = last?.rideId === session.rideId ? Number(last.atMs) : 0;
  if (lastRideMs > 0 && Date.now() - lastRideMs < RIDE_PUBLISH_STALE_MS) {
    return { status: 'active', source: 'native' };
  }

  const published = await publishImmediate(
    session,
    { force: true },
    { timeoutMs: RIDE_IMMEDIATE_FIX_TIMEOUT_MS }
  ).catch((error) => {
    traceTracking('active_ride.repair_publish_failed', session, {
      reason: error?.code || error?.message || 'unknown',
      trigger,
      result: 'not_published',
    }, 'warn');
    return false;
  });
  if (published) {
    traceTracking('active_ride.point_repaired', session, {
      trigger,
      staleForMs: lastRideMs > 0 ? Date.now() - lastRideMs : null,
      result: 'published',
    });
    return { status: 'active', source: 'supervisor' };
  }
  reportRideTrackingIssue(session, 'waiting_gps', 'no_fix');
  return { status: 'waiting_gps' };
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
