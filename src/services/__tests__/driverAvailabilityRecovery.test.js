jest.mock('firebase/firestore', () => ({ doc: jest.fn(() => ({})), getDocFromServer: jest.fn() }));
jest.mock('../../config/firebase', () => ({ auth: { currentUser: { uid: 'driver' } }, db: {} }));
jest.mock('../driverLocationTracking', () => ({ getDriverTrackingSession: jest.fn(), refreshDriverOnlineHeartbeat: jest.fn() }));
jest.mock('../driverDeviceDiagnostics', () => ({ getDriverDeviceDiagnostic: jest.fn() }));

const { getDocFromServer } = require('firebase/firestore');
const { getDriverTrackingSession, refreshDriverOnlineHeartbeat } = require('../driverLocationTracking');
const { getDriverDeviceDiagnostic } = require('../driverDeviceDiagnostics');
const { recoverDriverAvailability } = require('../driverAvailabilityRecovery');
const NOW = 1_800_000_000_000;
const SESSION = 'work_driver_1234567890';
const profile = (extra = {}) => ({
  availabilityStatus: 'online', availabilitySessionId: SESSION, locationAvailabilitySessionId: SESSION,
  availabilityUpdatedAtMs: NOW, locationUpdatedAtMs: NOW,
  verificationStatus: 'approved', pixKey: 'driver@example.test', pixKeyType: 'email',
  commissionFreeUntil: NOW + 86_400_000, location: { lat: -4.1, lng: -38.5 }, ...extra,
});
const snapshot = (data) => ({ exists: () => true, data: () => data });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  getDriverTrackingSession.mockResolvedValue({ driverId: 'driver', availabilitySessionId: SESSION });
  getDocFromServer.mockResolvedValue(snapshot(profile()));
  refreshDriverOnlineHeartbeat.mockResolvedValue({ status: 'published' });
  getDriverDeviceDiagnostic.mockResolvedValue({ healthy: true, blocking: false, primaryIssue: null });
});
afterEach(() => jest.restoreAllMocks());

it('requires a server-confirmed fresh point and matching local session', async () => {
  await expect(recoverDriverAvailability()).resolves.toEqual({ status: 'ready' });
  expect(refreshDriverOnlineHeartbeat).toHaveBeenCalledWith({ force: true });
  expect(getDocFromServer).toHaveBeenCalledTimes(2);
});
it('does not claim recovery when only the heartbeat succeeds', async () => {
  refreshDriverOnlineHeartbeat.mockResolvedValue({ status: 'heartbeat_only' });
  await expect(recoverDriverAvailability()).rejects.toMatchObject({ code: 'LOCATION_NOT_CONFIRMED' });
});
it('does not revive a closed or replaced work session', async () => {
  getDocFromServer.mockResolvedValue(snapshot(profile({ availabilityStatus: 'offline' })));
  await expect(recoverDriverAvailability()).rejects.toMatchObject({ code: 'SESSION_RESTART_REQUIRED' });
  expect(refreshDriverOnlineHeartbeat).not.toHaveBeenCalled();
});
it('preserves accepted rides and leaves their tracking to the active-ride screen', async () => {
  getDocFromServer.mockResolvedValue(snapshot(profile({ activeRideId: 'ride' })));
  await expect(recoverDriverAvailability()).resolves.toEqual({ status: 'active_ride' });
  expect(refreshDriverOnlineHeartbeat).not.toHaveBeenCalled();
});
it('fails safely when the server cannot be contacted', async () => {
  getDocFromServer.mockRejectedValue(Object.assign(new Error('network'), { code: 'unavailable' }));
  await expect(recoverDriverAvailability()).rejects.toMatchObject({ code: 'unavailable' });
  expect(refreshDriverOnlineHeartbeat).not.toHaveBeenCalled();
});
it('rejects a recovery if the driver stops work while the write is in flight', async () => {
  getDriverTrackingSession.mockResolvedValueOnce({ driverId: 'driver', availabilitySessionId: SESSION }).mockResolvedValueOnce(null);
  await expect(recoverDriverAvailability()).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
});
it('rejects a claimed publication when the actual server GPS remains stale', async () => {
  getDocFromServer.mockResolvedValue(snapshot(profile({ locationUpdatedAtMs: NOW - 8 * 60_000 })));
  await expect(recoverDriverAvailability()).rejects.toMatchObject({ code: 'AVAILABILITY_NOT_CONFIRMED' });
});
it('requires usable device permissions even after a successful server write', async () => {
  getDriverDeviceDiagnostic.mockResolvedValue({ blocking: true, primaryIssue: { code: 'services_disabled' } });
  await expect(recoverDriverAvailability()).rejects.toMatchObject({ code: 'DEVICE_NOT_READY' });
});
