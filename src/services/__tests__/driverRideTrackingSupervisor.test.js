// Behavior tests for the ride live-location fixes (field incident 2026-09-27).
// Native modules and Firebase are mocked; the real driverLocationTracking module
// runs, including its AsyncStorage session handling.

jest.mock('@react-native-async-storage/async-storage', () => (
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
));
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3 },
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({ isTaskDefined: jest.fn(() => false), defineTask: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  deleteDoc: jest.fn(async () => undefined),
  doc: jest.fn((_db, collection, id) => ({ path: `${collection}/${id}` })),
  getDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'SERVER_TIME'),
  setDoc: jest.fn(async () => undefined),
  updateDoc: jest.fn(async () => undefined),
}));
jest.mock('../../config/firebase', () => ({ auth: { currentUser: { uid: 'driver_ride_1' } }, db: {} }));
jest.mock('../../config/runtimeEnvironment', () => ({
  APP_BUILD_NUMBER: 24, APP_VERSION: '1.0.19', DEV_RIDE_SIMULATOR_ENABLED: false,
}));
jest.mock('../clientErrorReporter', () => ({ recordClientNonFatal: jest.fn(async () => ({ sent: true })) }));
jest.mock('../driverBackgroundReliabilityStore', () => ({ reportBackgroundIncident: jest.fn(async () => undefined) }));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const Location = require('expo-location');
const { setDoc } = require('firebase/firestore');
const ReactNative = require('react-native');
const { recordClientNonFatal } = require('../clientErrorReporter');
const tracking = require('../driverLocationTracking');

const DRIVER = 'driver_ride_1';
const SESSION = 'work_session_ride_000001';
const RIDE = 'ride_frozen_map_0001';
const SESSION_KEY = '@drivelocal/driver-location-session-v1';
const fix = () => ({
  coords: { latitude: -4.0987, longitude: -38.4987, accuracy: 6, heading: 90, speed: 0 },
  timestamp: Date.now(),
});
const storedSession = async () => JSON.parse(await AsyncStorage.getItem(SESSION_KEY));
const rideWrites = () => setDoc.mock.calls.filter(([ref]) => ref.path === `activeRideLocations/${RIDE}`);
const attach = (extra = {}) => tracking.attachActiveRideTracking({
  driverId: DRIVER, vehicleType: 'car', availabilitySessionId: SESSION, rideId: RIDE, ...extra,
});

let nativeStarted = false;

beforeAll(() => {
  Object.defineProperty(ReactNative.Platform, 'OS', { configurable: true, get: () => 'android' });
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ReactNative.AppState.currentState = 'active';
  nativeStarted = false;
  Location.hasServicesEnabledAsync.mockResolvedValue(true);
  Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Location.hasStartedLocationUpdatesAsync.mockImplementation(async () => nativeStarted);
  Location.startLocationUpdatesAsync.mockImplementation(async () => { nativeStarted = true; });
  Location.stopLocationUpdatesAsync.mockImplementation(async () => { nativeStarted = false; });
  Location.getLastKnownPositionAsync.mockImplementation(async () => fix());
  Location.getCurrentPositionAsync.mockImplementation(async () => fix());
});

afterEach(() => jest.restoreAllMocks());

async function startOnline() {
  await tracking.startDriverOnlineTracking({ driverId: DRIVER, vehicleType: 'car', availabilitySessionId: SESSION });
  jest.clearAllMocks();
}

describe('ride start', () => {
  it('publishes the ride point and samples by time even when the car is stopped', async () => {
    await startOnline();
    await expect(attach()).resolves.toMatchObject({ status: 'active', rideId: RIDE });

    const options = Location.startLocationUpdatesAsync.mock.calls[0][1];
    expect(options).toMatchObject({ timeInterval: 5_000, distanceInterval: 0, deferredUpdatesDistance: 0 });
    expect(rideWrites()).toHaveLength(1);
  });

  it('keeps the ride session when the first GPS fix fails, instead of falling back to online', async () => {
    await startOnline();
    Location.getLastKnownPositionAsync.mockResolvedValue(null);
    Location.getCurrentPositionAsync.mockRejectedValue(Object.assign(new Error('no fix'), { code: 'E_NO_FIX' }));

    await expect(attach()).resolves.toMatchObject({ status: 'waiting_gps', rideId: RIDE });

    expect(await storedSession()).toMatchObject({ rideId: RIDE, availabilitySessionId: SESSION });
    // Exactly one native start (ride mode). The old code restarted the online
    // service here, which never writes the passenger's ride point.
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(Location.startLocationUpdatesAsync.mock.calls[0][1].timeInterval).toBe(5_000);
    expect(recordClientNonFatal).toHaveBeenCalledTimes(1);
    expect(recordClientNonFatal.mock.calls[0][1]).toMatchObject({
      eventName: 'driver.ride_tracking.degraded', role: 'driver', severity: 'warning',
    });
  });

  it('never stops a running service it may not be allowed to restart from background', async () => {
    await startOnline();
    ReactNative.AppState.currentState = 'background';

    await expect(attach()).resolves.toMatchObject({ status: 'active' });

    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(await storedSession()).toMatchObject({ rideId: RIDE });
    expect(rideWrites()).toHaveLength(1);
  });

  it('keeps the online start path unchanged: a failed first fix still rolls back and throws', async () => {
    Location.getLastKnownPositionAsync.mockResolvedValue(null);
    Location.getCurrentPositionAsync.mockRejectedValue(new Error('no fix'));
    await expect(tracking.startDriverOnlineTracking({
      driverId: DRIVER, vehicleType: 'car', availabilitySessionId: SESSION,
    })).rejects.toThrow('no fix');
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('ride stage changes', () => {
  it('reuses the running ride service instead of restarting it', async () => {
    await startOnline();
    await attach();
    jest.clearAllMocks();

    await expect(attach({ rideStatus: 'driver_arrived' })).resolves.toMatchObject({ status: 'active' });

    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(await storedSession()).toMatchObject({ rideId: RIDE, rideStatus: 'driver_arrived' });
  });

  it('still fully restarts when the driver presses the activation button', async () => {
    await startOnline();
    await attach();
    jest.clearAllMocks();
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Location.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });

    await attach({ requestPermissions: true });
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });
});

describe('ride supervisor', () => {
  async function rideRunning(rideId = RIDE) {
    await startOnline();
    await attach({ rideId });
    jest.clearAllMocks();
  }

  it('does nothing while the ride point is fresh', async () => {
    await rideRunning();
    await expect(tracking.superviseActiveRideTracking()).resolves.toEqual({ status: 'active', source: 'native' });
    expect(rideWrites()).toHaveLength(0);
  });

  it('republishes a ride point that stopped flowing', async () => {
    await rideRunning();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 25_000);

    await expect(tracking.superviseActiveRideTracking()).resolves.toEqual({ status: 'active', source: 'supervisor' });
    expect(rideWrites()).toHaveLength(1);
  });

  it('restarts a service Android stopped, in the foreground only', async () => {
    await rideRunning();
    nativeStarted = false;

    ReactNative.AppState.currentState = 'background';
    await expect(tracking.superviseActiveRideTracking()).resolves.toEqual({ status: 'service_not_started' });
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();

    ReactNative.AppState.currentState = 'active';
    await expect(tracking.superviseActiveRideTracking()).resolves.toMatchObject({ status: 'active' });
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('reports a missing permission instead of pretending to repair', async () => {
    await rideRunning();
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(tracking.superviseActiveRideTracking()).resolves.toEqual({ status: 'background_required' });
  });

  it('reports each degraded state once per ride, not on every pulse', async () => {
    // Its own ride id: the once-per-ride memory is module-wide by design.
    await rideRunning('ride_report_once_0002');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 25_000);
    Location.getLastKnownPositionAsync.mockResolvedValue(null);
    Location.getCurrentPositionAsync.mockRejectedValue(new Error('no fix'));

    await tracking.superviseActiveRideTracking();
    await tracking.superviseActiveRideTracking();
    expect(recordClientNonFatal).toHaveBeenCalledTimes(1);
  });

  it('shares one run between concurrent callers', async () => {
    await rideRunning();
    const [a, b] = await Promise.all([
      tracking.superviseActiveRideTracking({ reason: 'screen_interval' }),
      tracking.superviseActiveRideTracking({ reason: 'layout_pulse' }),
    ]);
    expect(a).toBe(b);
  });

  it('is released after a ride start, even a failed one, and then repairs', async () => {
    await startOnline();
    Location.getLastKnownPositionAsync.mockResolvedValueOnce(null);
    Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('no fix'));
    await expect(attach({ rideId: 'ride_released_0003' })).resolves.toMatchObject({ status: 'waiting_gps' });

    await expect(tracking.superviseActiveRideTracking()).resolves.toEqual({ status: 'active', source: 'supervisor' });
  });

  it('waits instead of racing a ride start that is still running', async () => {
    await startOnline();
    let releaseFix;
    Location.getLastKnownPositionAsync.mockResolvedValueOnce(null);
    Location.getCurrentPositionAsync.mockImplementationOnce(() => new Promise((resolve) => { releaseFix = resolve; }));
    const starting = attach({ rideId: 'ride_racing_0004' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(tracking.superviseActiveRideTracking()).resolves.toEqual({ status: 'checking' });
    releaseFix(fix());
    await expect(starting).resolves.toMatchObject({ status: 'active' });
  });

  it('stays out of the online work session', async () => {
    await startOnline();
    await expect(tracking.superviseActiveRideTracking()).resolves.toEqual({ status: 'no_ride_session' });
  });
});
