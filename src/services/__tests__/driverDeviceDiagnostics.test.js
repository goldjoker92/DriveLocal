jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
}));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('expo-location', () => ({}));

jest.mock('../../config/runtimeEnvironment', () => ({
  DEV_RIDE_SIMULATOR_ENABLED: false,
}));

jest.mock('../driverLocationTracking', () => ({
  DRIVER_LOCATION_TASK: 'driver-location-task',
  getDriverTrackingSession: jest.fn(async () => null),
  refreshDriverOnlineHeartbeat: jest.fn(async () => ({ status: 'no_session' })),
  requestDriverTrackingPermissions: jest.fn(async () => ({ status: 'granted' })),
}));

jest.mock('../notificationsService', () => ({
  getPushNotificationDiagnosticState: jest.fn(async () => ({ status: 'registered' })),
  registerForPushNotifications: jest.fn(async () => 'token-not-exposed-to-policy'),
}));

const { deriveDriverDeviceDiagnostic } = require('../driverDeviceDiagnostics');

function location(overrides = {}) {
  return {
    status: 'granted',
    canAskAgain: true,
    precise: true,
    sessionPresent: false,
    trackingPaused: false,
    activeRide: false,
    nativeTaskStarted: false,
    lastPublishAtMs: 0,
    lastPublishAgeMs: null,
    lastRuntimeStatus: null,
    ...overrides,
  };
}

function notifications(overrides = {}) {
  return {
    status: 'registered',
    permissionGranted: true,
    canAskAgain: true,
    ...overrides,
  };
}

describe('driver device diagnostic priority policy', () => {
  it('is silent and ready when offline requirements are healthy', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location(),
      notifications: notifications(),
      expectTrackingActive: false,
      strictNotificationRegistration: true,
    });

    expect(result).toMatchObject({
      healthy: true,
      blocking: false,
      readyForAvailability: true,
      primaryIssue: null,
    });
  });

  it('blocks availability when phone location services are disabled', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location({ status: 'services_disabled', canAskAgain: false }),
      notifications: notifications(),
      expectTrackingActive: false,
    });

    expect(result.blocking).toBe(true);
    expect(result.readyForAvailability).toBe(false);
    expect(result.primaryIssue).toMatchObject({
      code: 'services_disabled',
      action: 'settings',
    });
  });

  it('sends permanently denied notifications to Android settings', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location(),
      notifications: notifications({
        status: 'permission_required',
        permissionGranted: false,
        canAskAgain: false,
      }),
      expectTrackingActive: false,
    });

    expect(result.primaryIssue).toMatchObject({
      code: 'notifications_settings_required',
      severity: 'blocking',
      action: 'settings',
    });
  });

  it('blocks an online work session when the native tracking task stopped', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location({
        sessionPresent: true,
        nativeTaskStarted: false,
        lastPublishAtMs: 1_000_000,
        lastPublishAgeMs: 10_000,
      }),
      notifications: notifications(),
      expectTrackingActive: true,
    });

    expect(result.primaryIssue).toMatchObject({
      code: 'native_task_missing',
      severity: 'blocking',
    });
  });

  it('blocks an online session after the seven-minute location lease is stale', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location({
        sessionPresent: true,
        nativeTaskStarted: true,
        lastPublishAtMs: 1,
        lastPublishAgeMs: 7 * 60 * 1000 + 1,
      }),
      notifications: notifications(),
      expectTrackingActive: true,
    });

    expect(result.primaryIssue).toMatchObject({
      code: 'location_stale',
      severity: 'blocking',
    });
  });

  it('treats a temporary notification sync failure as warning while already online', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location({
        sessionPresent: true,
        nativeTaskStarted: true,
        lastPublishAtMs: 1_000_000,
        lastPublishAgeMs: 10_000,
      }),
      notifications: notifications({ status: 'sync_failed' }),
      expectTrackingActive: true,
      strictNotificationRegistration: false,
    });

    expect(result.blocking).toBe(false);
    expect(result.readyForAvailability).toBe(true);
    expect(result.primaryIssue).toMatchObject({
      code: 'notification_registration_warning',
      severity: 'warning',
    });
  });

  it('requires notification registration before opening a new work session', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location(),
      notifications: notifications({ status: 'sync_failed' }),
      expectTrackingActive: false,
      strictNotificationRegistration: true,
    });

    expect(result.blocking).toBe(true);
    expect(result.primaryIssue).toMatchObject({
      code: 'notification_registration_required',
      severity: 'blocking',
    });
  });

  it('marks active rides so the guard can preserve their tracking flow', () => {
    const result = deriveDriverDeviceDiagnostic({
      location: location({
        sessionPresent: true,
        activeRide: true,
        nativeTaskStarted: false,
        lastPublishAtMs: 1_000_000,
        lastPublishAgeMs: 10_000,
      }),
      notifications: notifications(),
      expectTrackingActive: true,
    });

    expect(result.activeRide).toBe(true);
    expect(result.blocking).toBe(true);
  });
});
