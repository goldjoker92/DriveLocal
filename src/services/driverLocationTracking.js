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

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
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
  await AsyncStorage.setItem(DEV_OVERRIDE_KEY, JSON.stringify({ driverId, rideId, atMs: Date.now() }));
}

async function clearDevOverride() {
  await AsyncStorage.removeItem(DEV_OVERRIDE_KEY);
}

async function writeSafeStatus(status) {
  try {
    await AsyncStorage.setItem(LAST_STATUS_KEY, JSON.stringify({ status, atMs: Date.now() }));
  } catch (_error) {
    // Tracking must never fail only because diagnostic persistence failed.
  }
}

async function authenticatedUid() {
  // Android may launch this module headlessly. Wait for persisted Firebase Auth
  // to restore before deciding that the driver is signed out.
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }
  return auth.currentUser?.uid || null;
}

async function publishLocation(session, locationObject) {
  const payload = safeTrackingPayload(locationObject);
  const currentUid = await authenticatedUid();
  if (!payload || !currentUid || currentUid !== session?.driverId) return false;

  const nowMs = Date.now();
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

  await writeSafeStatus(session.rideId ? 'active_ride_published' : 'online_published');
  return true;
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
    } catch (_error) {
      await writeSafeStatus('publish_error');
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

async function ensureNativeTaskStarted() {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (started) return;

  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5_000,
    distanceInterval: 10,
    deferredUpdatesInterval: 5_000,
    deferredUpdatesDistance: 10,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'DriveLocal — localização ativa',
      notificationBody: 'Sua posição está sendo usada para o despacho e para a corrida atual.',
      notificationColor: '#2563EB',
      killServiceOnDestroy: false,
    },
  });
}

async function publishImmediate(session) {
  const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 100 });
  const current = lastKnown || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  await publishLocation(session, current);
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

  // While the explicit DEV override is active, lifecycle re-renders must not
  // restart native GPS and overwrite the synthetic point. Production can never
  // reach this branch because the build flag fails closed.
  const override = await readDevOverride();
  if (override && override.driverId === driverId && override.rideId === rideId) {
    await writeSafeStatus('dev_simulation_override_preserved');
    return { status: 'active', rideId, source: 'dev_simulation' };
  }

  await ensureNativeTaskStarted();
  await publishImmediate(session);
  return { status: 'active', rideId, source: 'native' };
}

export function startDriverOnlineTracking({ driverId, vehicleType, requestPermissions = false }) {
  return startSession({ driverId, vehicleType, rideId: null, requestPermissions });
}

export async function attachActiveRideTracking({ driverId, vehicleType, rideId, requestPermissions = false }) {
  return startSession({ driverId, vehicleType, rideId, requestPermissions });
}

// DEV-only override used by the two-phone manual test lab. It stops the native
// task but preserves the authenticated tracking session and Firestore rules.
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
    }
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
  await ensureNativeTaskStarted();
  await publishImmediate(session);
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
  await writeSession({ ...session, rideId: null, updatedAtMs: Date.now() });
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
