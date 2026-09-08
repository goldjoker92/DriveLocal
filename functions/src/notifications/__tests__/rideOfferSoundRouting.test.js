jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

const C = require('../../rides/constants');
const { fixedClock } = require('../../time/clock');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const { syncNotificationToken } = require('../tokens');
const {
  buildTokenMessage,
  processRideNotificationEvent,
} = require('../processEvent');

const T0 = 1_700_000_000_000;
const context = { traceId: 'trace_offer_sound_channels' };

function offerEvent(overrides = {}) {
  return {
    notificationId: 'ride-1_offer_created_driver-1',
    eventType: C.NOTIFICATION_EVENT.OFFER_CREATED,
    rideId: 'ride-1',
    offerId: 'ride-1_driver-1',
    recipientUid: 'driver-1',
    recipientRole: 'driver',
    route: '/ride-request',
    traceId: 'trace-offer',
    status: C.NOTIFICATION_STATUS.PENDING,
    attemptCount: 0,
    ...overrides,
  };
}

function tokenRequest(data) {
  return { auth: { uid: 'driver-1' }, data };
}

describe('driver offer channel capability storage', () => {
  it('defaults missing capability to V1 and overwrites any former custom-sound value', async () => {
    const db = makeFakeFirestore();
    const ref = db.collection(C.NOTIFICATION_TOKENS).doc('driver-1_install-1');
    await ref.set({
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
    });

    const result = await syncNotificationToken({
      db,
      request: tokenRequest({
        installationId: 'install-1',
        platform: 'android',
        token: 'token-legacy',
      }),
      context,
      clock: fixedClock(T0),
    });

    expect(result).toEqual({
      active: true,
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
    });
    expect(db._store.get(`${C.NOTIFICATION_TOKENS}/driver-1_install-1`))
      .toMatchObject({
        active: true,
        rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
      });
  });

  it('accepts every known explicit sound capability and rejects unknown values', async () => {
    const db = makeFakeFirestore();
    const capabilities = [
      C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2,
      C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V3,
      C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4,
    ];

    for (const [index, capability] of capabilities.entries()) {
      await expect(syncNotificationToken({
        db,
        request: tokenRequest({
          installationId: `install-${index + 2}`,
          platform: 'android',
          token: `token-${capability}`,
          rideOfferChannelCapability: capability,
        }),
        context,
        clock: fixedClock(T0),
      })).resolves.toMatchObject({
        rideOfferChannelCapability: capability,
      });
    }

    await expect(syncNotificationToken({
      db,
      request: tokenRequest({
        installationId: 'install-unknown',
        platform: 'android',
        token: 'token-unknown',
        rideOfferChannelCapability: 'untrusted_future_value',
      }),
      context,
      clock: fixedClock(T0),
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('driver offer sound routing', () => {
  it('changes only channel and sound between legacy and verified V2 messages', () => {
    const event = offerEvent();
    const legacy = buildTokenMessage(event, {
      token: 'token-legacy',
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1,
    });
    const v2 = buildTokenMessage(event, {
      token: 'token-v2',
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2,
    });

    expect(legacy.notification).toEqual(v2.notification);
    expect(legacy.data).toEqual(v2.data);
    expect(legacy.android.priority).toBe(v2.android.priority);
    expect(legacy.android.ttl).toBe(v2.android.ttl);
    expect(legacy.android.collapseKey).toBe(v2.android.collapseKey);
    expect(legacy.android.notification).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_OFFERS,
      sound: 'default',
      defaultVibrateTimings: true,
    });
    expect(v2.android.notification).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V2,
      sound: C.NOTIFICATION_SOUNDS.RIDE_OFFER,
      defaultVibrateTimings: true,
    });
    expect(legacy.android.notification.tag).toBe(v2.android.notification.tag);
  });

  // Android channel sounds cannot be changed after creation. V4 owns the
  // 30-second alert, while older app versions keep their V2/V3 routing.
  it('routes each capability to the offer channel that exists on the device', () => {
    const event = offerEvent();
    const byCapability = (capability) => buildTokenMessage(event, {
      token: `token-${capability}`,
      rideOfferChannelCapability: capability,
    }).android.notification;

    expect(byCapability(C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V4)).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      sound: C.NOTIFICATION_SOUNDS.RIDE_OFFER,
    });
    expect(byCapability(C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V3)).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V3,
      sound: C.NOTIFICATION_SOUNDS.RIDE_OFFER,
    });
    expect(byCapability(C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2)).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V2,
      sound: C.NOTIFICATION_SOUNDS.RIDE_OFFER,
    });
    expect(byCapability(C.RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1)).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_OFFERS,
      sound: 'default',
    });
    // An unknown value must never route to a channel the device may not have.
    expect(byCapability('custom_sound_v9')).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_OFFERS,
      sound: 'default',
    });
  });

  it('does not alter passenger status or arrival channels when a token supports V2', () => {
    const target = {
      token: 'token-v2',
      rideOfferChannelCapability: C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2,
    };
    const assigned = buildTokenMessage(offerEvent({
      eventType: C.NOTIFICATION_EVENT.RIDE_ASSIGNED,
      recipientRole: 'passenger',
    }), target);
    const arrived = buildTokenMessage(offerEvent({
      eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
      recipientRole: 'passenger',
    }), target);

    expect(assigned.android.notification).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_STATUS,
      sound: 'default',
      defaultVibrateTimings: true,
    });
    expect(arrived.android.notification).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL,
      sound: C.NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
      defaultVibrateTimings: false,
    });
  });

  it('sends exactly one visual notification per V1/V2/V3/V4 device', async () => {
    const db = makeFakeFirestore();
    const event = offerEvent();
    const eventRef = db.collection(C.NOTIFICATION_EVENTS).doc(event.notificationId);
    await eventRef.set(event);
    await db.collection(C.NOTIFICATION_TOKENS).doc('legacy').set({
      uid: event.recipientUid,
      token: 'token-legacy',
      platform: 'android',
      active: true,
    });
    for (const version of [2, 3, 4]) {
      await db.collection(C.NOTIFICATION_TOKENS).doc(`v${version}`).set({
        uid: event.recipientUid,
        token: `token-v${version}`,
        platform: 'android',
        active: true,
        rideOfferChannelCapability:
          C.RIDE_OFFER_CHANNEL_CAPABILITIES[`CUSTOM_SOUND_V${version}`],
      });
    }

    const messaging = {
      sendEach: jest.fn(async (messages) => ({
        responses: messages.map(() => ({ success: true })),
      })),
    };
    const result = await processRideNotificationEvent({
      db,
      messaging,
      eventRef,
      event,
      context,
      clock: fixedClock(T0),
    });

    expect(result).toEqual({
      status: C.NOTIFICATION_STATUS.SENT,
      successCount: 4,
      failureCount: 0,
    });
    expect(messaging.sendEach).toHaveBeenCalledTimes(1);
    const [messages] = messaging.sendEach.mock.calls[0];
    expect(messages).toHaveLength(4);
    expect(messages.map((message) => message.token).sort()).toEqual([
      'token-legacy',
      'token-v2',
      'token-v3',
      'token-v4',
    ]);
    expect(messages.map((message) => message.android.notification.channelId).sort())
      .toEqual([
        C.NOTIFICATION_CHANNELS.RIDE_OFFERS,
        C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V2,
        C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V3,
        C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V4,
      ].sort());
    messages.forEach((message) => {
      expect(message.notification).toEqual({
        title: 'Nova corrida disponível',
        body: 'Abra a DriveLocal para ver e aceitar a oferta.',
      });
      expect(message.data).toMatchObject({
        rideId: event.rideId,
        offerId: event.offerId,
        route: '/ride-request',
      });
    });
  });
});
