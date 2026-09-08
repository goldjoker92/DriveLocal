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
  getNotificationChannelAsync: jest.fn(),
  deleteNotificationChannelAsync: jest.fn(async () => undefined),
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(async () => undefined),
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
  RIDE_OFFER_CHANNEL_CAPABILITIES,
  RIDE_OFFER_VIBRATION_PATTERN,
} = require('../../constants/notificationChannels');
const {
  dismissRideOfferNotifications,
  ensureAndroidChannels,
  getPushNotificationDiagnosticState,
  isRideOfferSoundChannelReady,
  registerForPushNotifications,
} = require('../notificationsService');

describe('notification readiness diagnostics', () => {
  let storage;
  let mockSyncToken;

  beforeEach(() => {
    jest.clearAllMocks();
    Notifications.setNotificationChannelAsync.mockResolvedValue(undefined);
    Notifications.getPresentedNotificationsAsync.mockResolvedValue([]);
    Notifications.dismissNotificationAsync.mockResolvedValue(undefined);
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
    Notifications.getNotificationChannelAsync.mockResolvedValue({
      id: NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      sound: 'custom',
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: true,
    });
  });

  it('keeps V1 and creates verified V4 plus the existing arrival channel', async () => {
    await expect(ensureAndroidChannels()).resolves.toBe(
      RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
    );

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(4);
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.RIDE_OFFERS,
      expect.objectContaining({
        name: 'Corridas disponíveis',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [...RIDE_OFFER_VIBRATION_PATTERN],
        enableVibrate: true,
      }),
    );
    const legacyCall = Notifications.setNotificationChannelAsync.mock.calls.find(
      ([channelId]) => channelId === NOTIFICATION_CHANNELS.RIDE_OFFERS,
    );
    expect(legacyCall[1]).not.toHaveProperty('sound');
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      expect.objectContaining({
        importance: Notifications.AndroidImportance.MAX,
        sound: NOTIFICATION_SOUNDS.RIDE_OFFER,
        vibrationPattern: [...RIDE_OFFER_VIBRATION_PATTERN],
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
    );
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

  // Android channel settings are immutable after creation. V4 is a fresh id
  // for the 30-second sound; the superseded V2/V3 entries are never recreated.
  it('removes superseded V2 and V3 channels once V4 is verified', async () => {
    await expect(ensureAndroidChannels()).resolves.toBe(
      RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
    );

    expect(Notifications.deleteNotificationChannelAsync).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.RIDE_OFFERS_V2,
    );
    expect(Notifications.deleteNotificationChannelAsync).toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.RIDE_OFFERS_V3,
    );
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.RIDE_OFFERS_V2,
      expect.anything(),
    );
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalledWith(
      NOTIFICATION_CHANNELS.RIDE_OFFERS_V3,
      expect.anything(),
    );
  });

  it('keeps superseded channels when V4 cannot be verified', async () => {
    Notifications.getNotificationChannelAsync.mockResolvedValue({
      id: NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      sound: null,
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: true,
    });

    await expect(ensureAndroidChannels()).resolves.toBe(
      RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
    );
    expect(Notifications.deleteNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('requires Android to confirm custom sound, high importance and vibration', () => {
    expect(isRideOfferSoundChannelReady({
      id: NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      sound: 'custom',
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: true,
    })).toBe(true);
    expect(isRideOfferSoundChannelReady({
      id: NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      sound: null,
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: true,
    })).toBe(false);
    expect(isRideOfferSoundChannelReady({
      id: NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      sound: 'custom',
      importance: 1,
      enableVibrate: true,
    })).toBe(false);
  });

  it('dismisses only matching ride-offer notifications', async () => {
    const notification = (identifier, data) => ({
      request: {
        identifier,
        content: { data },
      },
    });
    Notifications.getPresentedNotificationsAsync.mockResolvedValue([
      notification('offer-exact', {
        eventType: 'offer_created',
        offerId: 'offer-1',
        rideId: 'ride-1',
      }),
      notification('offer-same-ride', {
        eventType: 'offer_created',
        offerId: '',
        rideId: 'ride-1',
      }),
      notification('other-offer', {
        eventType: 'offer_created',
        offerId: 'offer-2',
        rideId: 'ride-2',
      }),
      notification('ride-status', {
        eventType: 'ride_assigned',
        offerId: 'offer-1',
        rideId: 'ride-1',
      }),
    ]);

    await expect(dismissRideOfferNotifications({
      offerId: 'offer-1',
      rideId: 'ride-1',
    })).resolves.toBe(2);

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(2);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('offer-exact');
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('offer-same-ride');
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith('other-offer');
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith('ride-status');
  });

  it('never fails a ride decision when notification cleanup fails', async () => {
    Notifications.getPresentedNotificationsAsync.mockRejectedValue(
      Object.assign(new Error('native cleanup failed'), { code: 'ERR_NOTIFICATION_CLEANUP' }),
    );

    await expect(dismissRideOfferNotifications({
      offerId: 'offer-1',
      rideId: 'ride-1',
    })).resolves.toBe(0);
  });

  it('persists only a safe registration receipt, never the FCM token', async () => {
    const token = await registerForPushNotifications('driver');

    expect(token).toBe('SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED');
    expect(mockSyncToken).toHaveBeenCalledTimes(1);
    expect(mockSyncToken.mock.calls[0][0]).toMatchObject({
      token: 'SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED',
      platform: 'android',
      role: 'driver',
      rideOfferChannelCapability:
        RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
    });

    const persistedValues = AsyncStorage.setItem.mock.calls.map((call) => String(call[1]));
    expect(persistedValues.join('|')).not.toContain('SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED');
    expect(persistedValues.join('|')).toContain('"status":"registered"');

    const diagnostic = await getPushNotificationDiagnosticState({ nowMs: Date.now() });
    expect(diagnostic).toMatchObject({
      status: 'registered',
      permissionGranted: true,
      role: 'driver',
      rideOfferChannelCapability:
        RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
    });
  });

  it('keeps registration on V1 when Android cannot verify the V4 sound', async () => {
    Notifications.getNotificationChannelAsync.mockResolvedValue({
      id: NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      sound: null,
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: true,
    });

    await expect(registerForPushNotifications('driver')).resolves.toBe(
      'SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED',
    );
    expect(mockSyncToken).toHaveBeenCalledWith(expect.objectContaining({
      rideOfferChannelCapability: RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
    }));
  });

  it('keeps registration on V1 when creating V4 throws', async () => {
    Notifications.setNotificationChannelAsync.mockImplementation(async (channelId) => {
      if (channelId === NOTIFICATION_CHANNELS.RIDE_OFFERS_V4) {
        const error = new Error('native channel failure');
        error.code = 'ERR_CHANNEL_SETUP';
        throw error;
      }
      return undefined;
    });

    await expect(registerForPushNotifications('driver')).resolves.toBe(
      'SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED',
    );
    expect(mockSyncToken).toHaveBeenCalledWith(expect.objectContaining({
      rideOfferChannelCapability: RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
    }));
  });

  it('retries the legacy token payload when an older backend rejects capability', async () => {
    const oldBackendError = new Error('unknown field');
    oldBackendError.code = 'functions/invalid-argument';
    mockSyncToken
      .mockRejectedValueOnce(oldBackendError)
      .mockResolvedValueOnce({ data: { enabled: true } });

    await expect(registerForPushNotifications('driver')).resolves.toBe(
      'SECRET_FCM_TOKEN_MUST_NOT_BE_PERSISTED',
    );
    expect(mockSyncToken).toHaveBeenCalledTimes(2);
    expect(mockSyncToken.mock.calls[0][0]).toHaveProperty(
      'rideOfferChannelCapability',
      RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
    );
    expect(mockSyncToken.mock.calls[1][0]).not.toHaveProperty(
      'rideOfferChannelCapability',
    );
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
