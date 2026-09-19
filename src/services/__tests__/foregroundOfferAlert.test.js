// A ride offer arriving while the app is OPEN must be impossible to miss:
// same DriveLocal sound, vibration and light as when the app is closed.
//
// The bug it fixes: Android hands a foreground FCM message to
// expo-notifications' handler, which can play a sound but cannot pick a
// channel, so the sound comes from the default status channel — the generic
// system tone. A driver waiting on the cockpit (app open) is exactly the case
// that was losing the alert. The fix re-posts the offer as a local notification
// on the custom V4 channel.

const mockGetChannel = jest.fn();
const mockSchedule = jest.fn();

jest.mock('expo-notifications', () => ({
  getNotificationChannelAsync: (...a) => mockGetChannel(...a),
  scheduleNotificationAsync: (...a) => mockSchedule(...a),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));

jest.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../../config/firebase', () => ({ auth: {} }));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

const { presentForegroundRideOfferAlert } = require('../notificationsService');
const { NOTIFICATION_CHANNELS, NOTIFICATION_SOUNDS } = require('../../constants/notificationChannels');

const READY_CHANNEL = {
  id: NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
  sound: 'custom',
  importance: 5,
  enableVibrate: true,
};

const OFFER = {
  eventType: 'offer_created',
  offerId: 'ride_123_driver_9',
  rideId: 'ride_123',
  title: 'Nova corrida disponível',
  body: 'Centro · 8,4 km',
};

beforeEach(() => {
  mockGetChannel.mockReset();
  mockSchedule.mockReset();
  mockGetChannel.mockResolvedValue(READY_CHANNEL);
  mockSchedule.mockResolvedValue('scheduled');
});

describe('presentForegroundRideOfferAlert', () => {
  it('re-posts the offer on the custom V4 channel with the DriveLocal sound', async () => {
    const result = await presentForegroundRideOfferAlert(OFFER);

    expect(result).toBe(true);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.trigger.channelId).toBe(NOTIFICATION_CHANNELS.RIDE_OFFERS_V4);
    expect(arg.content.sound).toBe(NOTIFICATION_SOUNDS.RIDE_OFFER);
    // Reuses the offer id so the local copy replaces a duplicate and cleanup by
    // offer id keeps working.
    expect(arg.identifier).toBe('ride_123_driver_9');
  });

  it('flags the re-presented copy so it is never re-presented again', async () => {
    await presentForegroundRideOfferAlert(OFFER);
    const arg = mockSchedule.mock.calls[0][0];
    // The hook checks this flag before re-presenting, which is what breaks the
    // loop.
    expect(arg.content.data.foregroundRepresented).toBe(true);
    expect(arg.content.data.rideId).toBe('ride_123');
  });

  it('does nothing when the custom channel is not ready on this device', async () => {
    // e.g. an OEM stripped the sound, or the channel never came up. Better to
    // leave the default banner than post a broken or silent alert.
    mockGetChannel.mockResolvedValue({ ...READY_CHANNEL, sound: null });
    const result = await presentForegroundRideOfferAlert(OFFER);

    expect(result).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a ride offer', async () => {
    for (const eventType of ['ride_arrived', 'ride_assigned', 'driver_broadcast', '']) {
      expect(await presentForegroundRideOfferAlert({ ...OFFER, eventType })).toBe(false);
    }
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('ignores an offer with neither an offer id nor a ride id', async () => {
    const result = await presentForegroundRideOfferAlert({ eventType: 'offer_created' });
    expect(result).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('never throws when scheduling fails — dispatch must be unaffected', async () => {
    mockSchedule.mockRejectedValue(new Error('android channel gone'));
    await expect(presentForegroundRideOfferAlert(OFFER)).resolves.toBe(false);
  });

  it('falls back to safe copy when the payload has no title or body', async () => {
    await presentForegroundRideOfferAlert({
      eventType: 'offer_created',
      offerId: 'ride_x_driver_1',
    });
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title.length).toBeGreaterThan(0);
    expect(arg.content.body.length).toBeGreaterThan(0);
  });
});

// Contract: the hook must wire the re-presentation without re-sounding the
// original offer (which would double the alert) and without looping.
describe('useRideNotifications wiring', () => {
  const fs = require('fs');
  const hook = fs.readFileSync('src/hooks/useRideNotifications.js', 'utf8');

  it('re-presents a foreground offer on the custom channel', () => {
    expect(hook).toContain('presentForegroundRideOfferAlert');
    expect(hook).toContain("String(data.eventType || '') === 'offer_created'");
  });

  it('does not sound the raw foreground offer, so the alert never doubles', () => {
    // The offer's sound is carried by the re-presented V4 copy, not by the
    // original foreground notification.
    expect(hook).toContain('shouldPlaySound');
    expect(hook).toContain('!isOffer');
  });

  it('breaks the re-presentation loop with the foregroundRepresented flag', () => {
    expect(hook).toContain('foregroundRepresented !== true');
  });
});
