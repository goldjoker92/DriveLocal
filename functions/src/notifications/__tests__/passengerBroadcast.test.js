const {
  sendDriverBroadcast,
  sendPassengerBroadcast,
  isPassengerBroadcastRecipient,
  PASSENGER_BROADCAST_CAMPAIGNS,
  MIN_INTERVAL_MS,
} = require('../broadcast');
const {
  processRideNotificationEvent,
  presentationForEvent,
  androidNotificationForEvent,
} = require('../processEvent');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const C = require('../../rides/constants');

const nowMs = Date.parse('2026-09-25T18:00:00Z');
const clock = { now: () => nowMs };
const context = { traceId: 'test-passenger-broadcast' };
const message = {
  campaignId: 'update_passengers_20',
  title: 'Atualização do DriveLocal',
  body: 'Nova versão na Google Play. Atualize para ver o preço antes de confirmar. Sua conta continua.',
};

async function seed() {
  const db = makeFakeFirestore();
  await db.collection('admins').doc('admin_1').set({ active: true });
  await db.collection(C.DRIVERS).doc('driver_1').set({ verificationStatus: 'approved' });
  await db.collection(C.PASSENGERS).doc('passenger_1').set({ role: 'passenger' });
  await db.collection(C.PASSENGERS).doc('passenger_2').set({ role: 'passenger', activeRideId: 'ride_1' });
  await db.collection(C.PASSENGERS).doc('blocked').set({ isBlocked: true });
  await db.collection(C.PASSENGERS).doc('deleting').set({ accountDeletionStatus: 'requested' });
  await db.collection(C.PASSENGERS).doc('wrong_role').set({ role: 'driver' });
  return db;
}

const request = (uid = 'admin_1', data = message) => ({ auth: uid ? { uid } : null, data });
const events = (db) => [...db._store.values()]
  .filter((data) => data.eventType === C.NOTIFICATION_EVENT.PASSENGER_BROADCAST);

describe('passenger-only broadcast', () => {
  it('requires an authenticated admin and never creates events on rejection', async () => {
    const db = await seed();
    await expect(sendPassengerBroadcast({ db, request: request(null), context, clock }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(sendPassengerBroadcast({ db, request: request('passenger_1'), context, clock }))
      .rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(events(db)).toHaveLength(0);
  });

  it('targets passenger profiles and keeps the driver campaign separate', async () => {
    const db = await seed();
    expect(isPassengerBroadcastRecipient({ role: 'passenger' })).toBe(true);
    expect(isPassengerBroadcastRecipient({ accountDeletionStatus: 'blocked' })).toBe(false);

    // The same campaign id and timestamp can exist in both audiences: separate
    // cooldown collections and event types prevent cross-audience delivery.
    const driver = await sendDriverBroadcast({ db, request: request(), context, clock });
    const passenger = await sendPassengerBroadcast({ db, request: request(), context, clock });
    expect(driver.recipientCount).toBe(1);
    expect(passenger).toMatchObject({ recipientCount: 2, skippedCount: 3, replay: false });
    expect(db._store.has(`${PASSENGER_BROADCAST_CAMPAIGNS}/${message.campaignId}`)).toBe(true);
    expect(events(db)).toHaveLength(2);
    expect(events(db).map((data) => data.recipientUid).sort())
      .toEqual(['passenger_1', 'passenger_2']);
    for (const event of events(db)) {
      expect(event).toMatchObject({
        eventType: C.NOTIFICATION_EVENT.PASSENGER_BROADCAST,
        recipientRole: 'passenger',
        route: '/passenger-home',
        broadcastTitle: message.title,
        broadcastBody: message.body,
        status: C.NOTIFICATION_STATUS.PENDING,
      });
    }
    const driverEvent = [...db._store.values()]
      .find((data) => data.eventType === C.NOTIFICATION_EVENT.DRIVER_BROADCAST);
    expect(driverEvent).toMatchObject({ recipientUid: 'driver_1', route: '/driver-home' });
  });

  it('does not duplicate a campaign and rate-limits only passenger campaigns', async () => {
    const db = await seed();
    await sendPassengerBroadcast({ db, request: request(), context, clock });
    expect(await sendPassengerBroadcast({ db, request: request(), context, clock }))
      .toMatchObject({ replay: true, recipientCount: 2 });
    await expect(sendPassengerBroadcast({
      db, request: request('admin_1', { ...message, campaignId: 'second_campaign' }), context, clock,
    })).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      safeMetadata: { reason: 'BROADCAST_RATE_LIMITED', retryAfterMs: MIN_INTERVAL_MS },
    });
    expect(events(db)).toHaveLength(2);
    expect((await sendDriverBroadcast({ db, request: request(), context, clock })).recipientCount)
      .toBe(1);
  });

  it('batches all passengers without silently truncating the audience', async () => {
    const db = makeFakeFirestore();
    await db.collection('admins').doc('admin_1').set({});
    for (let i = 0; i < 401; i += 1) {
      await db.collection(C.PASSENGERS).doc(`p${i}`).set({ role: 'passenger' });
    }
    const result = await sendPassengerBroadcast({ db, request: request(), context, clock });
    expect(result.recipientCount).toBe(401);
    expect(events(db)).toHaveLength(401);
  });

  it('uses status notifications and skips explicit driver tokens for passenger push', async () => {
    const db = await seed();
    const event = {
      notificationId: 'update_passengers_20_passenger_broadcast_passenger_1',
      eventType: C.NOTIFICATION_EVENT.PASSENGER_BROADCAST,
      recipientUid: 'passenger_1', recipientRole: 'passenger',
      rideId: message.campaignId, route: '/passenger-home',
      broadcastTitle: message.title, broadcastBody: message.body,
      status: C.NOTIFICATION_STATUS.PENDING,
    };
    expect(presentationForEvent(event)).toEqual({ title: message.title, body: message.body });
    expect(androidNotificationForEvent(event)).toMatchObject({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_STATUS, sound: 'default',
    });
    await db.collection(C.NOTIFICATION_TOKENS).doc('legacy').set({
      uid: 'passenger_1', active: true, platform: 'android', token: 'old-client-token', role: null,
    });
    await db.collection(C.NOTIFICATION_TOKENS).doc('passenger').set({
      uid: 'passenger_1', active: true, platform: 'android', token: 'passenger-token', role: 'passenger',
    });
    await db.collection(C.NOTIFICATION_TOKENS).doc('driver').set({
      uid: 'passenger_1', active: true, platform: 'android', token: 'driver-token', role: 'driver',
    });
    const messaging = { sendEach: jest.fn(async (messages) => ({
      responses: messages.map(() => ({ success: true })),
    })) };
    await processRideNotificationEvent({
      db, messaging, event, clock, context,
      eventRef: db.collection(C.NOTIFICATION_EVENTS).doc(event.notificationId),
    });
    const sent = messaging.sendEach.mock.calls[0][0];
    expect(sent.map((item) => item.token).sort()).toEqual(['old-client-token', 'passenger-token']);
    expect(sent.every((item) => item.data.route === '/passenger-home')).toBe(true);
  });
});
