// @ts-check
// Lot 2: a ride offer must interrupt like an arrival does, and must never
// outlive the offer it announces.
//
// Before this, offer_created was sent with neither max priority nor public
// visibility (only ride_arrived had them) and with a flat 10-minute ttl. A
// driver whose phone reconnected five minutes later was woken up for a ride
// that had already been assigned to someone else or closed.

const {
  buildMulticastMessage,
  ttlMsForEvent,
  androidNotificationForEvent,
} = require('../processEvent');
const C = require('../../rides/constants');

const T0 = 1_760_000_000_000;

function offerEvent(overrides = {}) {
  return {
    notificationId: 'ride_x_offer_created_driver_1',
    eventType: C.NOTIFICATION_EVENT.OFFER_CREATED,
    rideId: 'ride_x',
    offerId: 'ride_x_driver_1',
    recipientUid: 'driver_1',
    recipientRole: 'driver',
    route: '/ride-request',
    expiresAtMs: T0 + 90_000,
    ...overrides,
  };
}

function statusEvent(overrides = {}) {
  return {
    notificationId: 'ride_x_ride_assigned_passenger',
    eventType: C.NOTIFICATION_EVENT.RIDE_ASSIGNED,
    rideId: 'ride_x',
    recipientUid: 'pax_1',
    recipientRole: 'passenger',
    route: '/ride-status',
    ...overrides,
  };
}

describe('ride offer notification presentation', () => {
  it('gives an offer max priority and public visibility', () => {
    const android = androidNotificationForEvent(offerEvent(), {
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V3,
    });

    expect(android.priority).toBe('max');
    expect(android.visibility).toBe('public');
    expect(android.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V3);
    expect(android.sound).toBe(C.NOTIFICATION_SOUNDS.RIDE_OFFER);
  });

  it('applies the same guarantees on the legacy channel', () => {
    // Old installations report legacy_v1 and get the default sound, but the
    // banner must still interrupt: they are the ones most at risk of a silent
    // miss, not the least.
    const android = androidNotificationForEvent(offerEvent(), {
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
    });

    expect(android.priority).toBe('max');
    expect(android.visibility).toBe('public');
    expect(android.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_OFFERS);
    expect(android.sound).toBe('default');
  });

  it('leaves ordinary ride status updates unpromoted', () => {
    // Escalating every status update would train drivers and passengers to mute
    // the app, and the same permission carries the offers.
    const android = androidNotificationForEvent(statusEvent());

    expect(android.priority).toBeUndefined();
    expect(android.visibility).toBeUndefined();
    expect(android.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_STATUS);
  });

  it('keeps the dedicated driver arrival presentation untouched', () => {
    const android = androidNotificationForEvent({
      ...statusEvent(),
      eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
    });

    expect(android.channelId).toBe(C.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL);
    expect(android.priority).toBe('max');
    expect(android.visibility).toBe('public');
    expect(android.vibrateTimingsMillis).toEqual([
      ...C.DRIVER_ARRIVAL_VIBRATION_PATTERN,
    ]);
  });
});

describe('notification ttl', () => {
  it('caps an offer ttl at its remaining life', () => {
    expect(ttlMsForEvent(offerEvent(), T0)).toBe(90_000);
    expect(ttlMsForEvent(offerEvent(), T0 + 30_000)).toBe(60_000);
  });

  it('never stores a dead offer for later delivery', () => {
    expect(ttlMsForEvent(offerEvent(), T0 + 90_000)).toBe(0);
    expect(ttlMsForEvent(offerEvent(), T0 + 10 * 60_000)).toBe(0);
  });

  it('keeps the generic ceiling for events without a deadline', () => {
    expect(ttlMsForEvent(statusEvent(), T0)).toBe(10 * 60 * 1000);
    expect(ttlMsForEvent(offerEvent({ expiresAtMs: null }), T0)).toBe(10 * 60 * 1000);
    expect(ttlMsForEvent(offerEvent({ expiresAtMs: 0 }), T0)).toBe(10 * 60 * 1000);
  });

  it('never exceeds the ceiling even for an implausible deadline', () => {
    const farFuture = offerEvent({ expiresAtMs: T0 + 24 * 60 * 60 * 1000 });
    expect(ttlMsForEvent(farFuture, T0)).toBe(10 * 60 * 1000);
  });

  it('tolerates a missing clock without producing a negative ttl', () => {
    expect(ttlMsForEvent(offerEvent(), 0)).toBeGreaterThanOrEqual(0);
    expect(ttlMsForEvent({}, T0)).toBe(10 * 60 * 1000);
  });

  it('is applied to the message actually sent to FCM', () => {
    const message = buildMulticastMessage(offerEvent(), ['token_1'], {
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V3,
      nowMs: T0 + 45_000,
    });

    expect(message.android.ttl).toBe(45_000);
    expect(message.android.priority).toBe('high');
    expect(message.android.notification.priority).toBe('max');
    // The payload stays strings-only: no coordinates, no PII, no wallet data.
    expect(message.data.rideId).toBe('ride_x');
    expect(message.data.offerId).toBe('ride_x_driver_1');
    expect(Object.values(message.data).every((v) => typeof v === 'string')).toBe(true);
  });
});
