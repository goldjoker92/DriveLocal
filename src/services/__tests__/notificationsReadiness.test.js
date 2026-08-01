jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { version: '1.0.0' },
  nativeAppVersion: '1.0.0',
}));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5, HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(),
}));

jest.mock('../../config/firebase', () => ({ functions: {} }));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const Notifications = require('expo-notifications');
const { httpsCallable } = require('firebase/functions');
const {
  DRIVER_ARRIVAL_VIBRATION_PATTERN,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SOUNDS,
} = require('../../constants/notificationChannels');
const {
  ensureAndroidChannels,
  getPushNotificationDiagnosticState,
  registerForPushNotifications,
} = require('../notificationsService');

describe('notification readiness diagnostics', () => {
  let storage;
  let mockSyncToken;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new Map();
    mockSyncToken = jest.fn(async () => ({ data: { enabled: true } }));
    httpsCallable.mockReturnValue(mockSyncToken);
    AsyncStorage.getItem.mockImplementation(async (key) => storage.get(key) || null);
    AsyncStorage.setItem.mockImplementation(async (key, value) => {
      storage.set(key, value);
    });
    Notifications.getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
    Notifications.requestPermissionsAsync.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
    });
    Notifications.getDevicePushTokenAsync.mockResolvedValue({
      type: 'fcm',
      data: 'SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED',
    });
  });

  it('creates a dedicated MAX arrival channel with independent sound and vibration', async () => {
    await ensureAndroidChannels();

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(3);
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.DRIVER_ARRIVAL,
      expect.objectContaining({
        name: 'Motorista chegou',
        importance: Notifications.AndroidImportance.MAX,
        sound: NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
        vibrationPattern: [...DRIVER_ARRIVAL_VIBRATION_PATTERN],
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
    );
  });

  it('persists only a safe registration receipt, never the FCM token', async () => {
    const token = await registerForPushNotifications('driver');

    expect(token).toBe('SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED');
    expect(mockSyncToken).toHaveBeenCalledTimes(1);
    expect(mockSyncToken.mock.calls[0][0]).toMatchObject({
      token: 'SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED',
      platform: 'android',
      role: 'driver',
    });

    const persistedValues = AsyncStorage.setItem.mock.calls.map((call) => String(call[1]));
    expect(persistedValues.join('|')).not.toContain('SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED');
    expect(persistedValues.join('|')).toContain('"status":"registered"');

    const diagnostic = await getPushNotificationDiagnosticState({ nowMs: Date.now() });
    expect(diagnostic).toMatchObject({
      status: 'registered',
      permissionGranted: true,
      role: 'driver',
    });
  });

  it('returns a settings-grade diagnostic after a permanent permission denial', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    });

    await expect(registerForPushNotifications('driver')).resolves.toBeNull();
    expect(mockSyncToken).not.toHaveBeenCalled();

    const diagnostic = await getPushNotificationDiagnosticState();
    expect(diagnostic).toMatchObject({
      status: 'permission_required',
      permissionGranted: false,
      canAskAgain: false,
    });
  });
});
