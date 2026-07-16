// Deterministic unit tests for BLOCK 09+10 (ride lifecycle, wallet settlement,
// notifications). In-memory fake Firestore + injected fake Admin Messaging — no
// emulator, no cloud, no real FCM send. Exactly the 6 critical invariants.
//
// Test doubles are TEST-ONLY; runtime uses the Firebase Admin SDK + Admin
// Messaging (verified by git grep in validation).

const lifecycle = require('../rides/lifecycle');
const { syncNotificationToken } = require('../notifications/tokens');
const { processRideNotificationEvent } = require('../notifications/processEvent');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const T0 = 1_700_000_000_000;
const ctx = { traceId: 'trace_life' };
const KEY = 'lc-key-00000001';

function seedRide(db, id, over = {}) {
  db.collection(C.RIDE_REQUESTS).doc(id).set({
    rideId: id,
    passengerId: 'P',
    acceptedDriverId: 'A',
    vehicleType: 'moto',
    pickup: { lat: -4.10, lng: -38.49, label: 'Centro' },
    destination: { lat: -4.11, lng: -38.50, label: 'Aurora' },
    estimatedFareCentavos: 655,
    estimatedCommissionCentavos: 79,
    commissionHoldCentavos: 79,
    status: C.RIDE_STATUS.ASSIGNED,
    ...over,
  });
}
function seedDriver(db, id, over = {}) {
  db.collection(C.DRIVERS).doc(id).set({
    vehicleType: 'moto', founderEligible: false, subscriptionActive: true,
    subscriptionExpiresAt: T0 + 10 * 864e5, commissionFreeUntil: null,
    walletBalanceCentavos: 5000, walletHeldCentavos: 79, walletAvailableCentavos: 4921,
    activeRideId: id === 'A' ? undefined : undefined, ...over,
  });
}
function seedOffer(db, rideId, driverId, status) {
  db.collection(C.DRIVER_OFFERS).doc(`${rideId}_${driverId}`).set({ rideId, driverId, status, pickupPreview: { label: 'x' } });
}
function req(uid, data) { return { auth: { uid }, data: { idempotencyKey: KEY, ...data } }; }
function events(db, rideId) {
  const ids = [];
  for (const k of db._store.keys()) if (k.startsWith(`${C.NOTIFICATION_EVENTS}/${rideId}_`)) ids.push(k);
  return ids;
}

describe('ride lifecycle — authorization & transitions', () => {
  it('L1: invalid or unauthorized transitions are rejected', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedRide(db, 'r1');
    // Unauthenticated.
    await expect(lifecycle.markDriverArrived({ db, request: { data: { rideId: 'r1', idempotencyKey: KEY } }, context: ctx, clock }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // Wrong driver.
    await expect(lifecycle.markDriverArrived({ db, request: req('X', { rideId: 'r1' }), context: ctx, clock }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Illegal jump (start requires driver_arrived, ride is assigned).
    await expect(lifecycle.startRide({ db, request: req('A', { rideId: 'r1' }), context: ctx, clock }))
      .rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('L2: destination is hidden before start and revealed only to the winner', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedRide(db, 'r2', { status: C.RIDE_STATUS.DRIVER_ARRIVED });
    seedOffer(db, 'r2', 'A', C.OFFER_STATUS.ACCEPTED);
    seedOffer(db, 'r2', 'B', C.OFFER_STATUS.OFFERED);
    expect(db._store.get(`${C.DRIVER_OFFERS}/r2_A`).exactDestination).toBeUndefined();

    await lifecycle.startRide({ db, request: req('A', { rideId: 'r2' }), context: ctx, clock });
    expect(db._store.get(`${C.RIDE_REQUESTS}/r2`).status).toBe(C.RIDE_STATUS.IN_PROGRESS);
    expect(db._store.get(`${C.DRIVER_OFFERS}/r2_A`).exactDestination).toMatchObject({ lat: -4.11, lng: -38.50 });
    expect(db._store.get(`${C.DRIVER_OFFERS}/r2_B`).exactDestination).toBeUndefined();
  });

  it('L3: duplicate transitions create exactly one notification event', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedRide(db, 'r3');
    await lifecycle.markDriverArrived({ db, request: req('A', { rideId: 'r3' }), context: ctx, clock });
    await lifecycle.markDriverArrived({ db, request: req('A', { rideId: 'r3' }), context: ctx, clock }); // replay
    expect(db._store.get(`${C.RIDE_REQUESTS}/r3`).status).toBe(C.RIDE_STATUS.DRIVER_ARRIVED);
    expect(events(db, 'r3')).toEqual([`${C.NOTIFICATION_EVENTS}/r3_ride_arrived_passenger`]);
  });
});

describe('wallet settlement', () => {
  it('L4: cancellation releases the hold exactly once', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedRide(db, 'r4');
    seedDriver(db, 'A');
    await lifecycle.cancelRide({ db, request: req('P', { rideId: 'r4', reasonCode: 'errei_endereco' }), context: ctx, clock });
    expect(db._store.get(`${C.RIDE_REQUESTS}/r4`).status).toBe(C.RIDE_STATUS.CANCELLED);
    expect(db._store.get(`${C.DRIVERS}/A`).walletHeldCentavos).toBe(0);
    expect(db._store.get(`${C.DRIVERS}/A`).walletAvailableCentavos).toBe(5000);
    // Second cancel is an idempotent replay — no second release.
    await lifecycle.cancelRide({ db, request: req('P', { rideId: 'r4', reasonCode: 'errei_endereco' }), context: ctx, clock });
    expect(db._store.get(`${C.DRIVERS}/A`).walletAvailableCentavos).toBe(5000);
  });

  it('L5: completion captures commission exactly once; promotion captures zero', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    // Standard driver.
    seedRide(db, 'r5', { status: C.RIDE_STATUS.AWAITING_PAYMENT, finalCommissionCentavos: 79 });
    seedDriver(db, 'A');
    await lifecycle.confirmDriverPixReceived({ db, request: req('A', { rideId: 'r5' }), context: ctx, clock });
    expect(db._store.get(`${C.RIDE_REQUESTS}/r5`).status).toBe(C.RIDE_STATUS.COMPLETED);
    expect(db._store.get(`${C.DRIVERS}/A`).walletBalanceCentavos).toBe(4921);
    expect(db._store.get(`${C.DRIVERS}/A`).walletHeldCentavos).toBe(0);
    expect(db._store.get(`${C.WALLET_TRANSACTIONS}/r5_capture`).amountCentavos).toBe(79);
    // Idempotent replay — no double capture.
    await lifecycle.confirmDriverPixReceived({ db, request: req('A', { rideId: 'r5' }), context: ctx, clock });
    expect(db._store.get(`${C.DRIVERS}/A`).walletBalanceCentavos).toBe(4921);

    // Founder in the commission-free window captures zero; wallet unchanged.
    const db2 = makeFakeFirestore();
    seedRide(db2, 'r5f', { status: C.RIDE_STATUS.AWAITING_PAYMENT, acceptedDriverId: 'F', commissionHoldCentavos: 0, finalCommissionCentavos: 79 });
    seedDriver(db2, 'F', { founderEligible: true, commissionFreeUntil: T0 + 60 * 864e5, walletBalanceCentavos: 0, walletHeldCentavos: 0, walletAvailableCentavos: 0 });
    const r = await lifecycle.confirmDriverPixReceived({ db: db2, request: req('F', { rideId: 'r5f' }), context: ctx, clock });
    expect(r.commissionCapturedCentavos).toBe(0);
    expect(db2._store.get(`${C.DRIVERS}/F`).walletBalanceCentavos).toBe(0);
  });
});

describe('notifications', () => {
  it('L6: token ownership/payload privacy and invalid-token disabling', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    // Ownership: unauthenticated + non-android rejected.
    await expect(syncNotificationToken({ db, request: { data: { installationId: 'i1', platform: 'android', token: 't' } }, context: ctx, clock }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(syncNotificationToken({ db, request: { auth: { uid: 'P' }, data: { installationId: 'i1', platform: 'ios', token: 't' } }, context: ctx, clock }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    // Two active Android tokens for recipient P; the second is dead at FCM.
    db.collection(C.NOTIFICATION_TOKENS).doc('P_good').set({ uid: 'P', token: 'tok_good', platform: 'android', active: true });
    db.collection(C.NOTIFICATION_TOKENS).doc('P_bad').set({ uid: 'P', token: 'tok_bad', platform: 'android', active: true });
    const evId = 'r6_ride_completed_passenger';
    db.collection(C.NOTIFICATION_EVENTS).doc(evId).set({
      notificationId: evId, eventType: 'ride_completed', rideId: 'r6', offerId: null,
      recipientUid: 'P', recipientRole: 'passenger', route: '/ride-completed', traceId: 'tX',
      status: C.NOTIFICATION_STATUS.PENDING, attemptCount: 0,
    });

    let sentMessage = null;
    const messaging = {
      async sendEachForMulticast(msg) {
        sentMessage = msg;
        return { responses: [{ success: true }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }] };
      },
    };
    const eventRef = db.collection(C.NOTIFICATION_EVENTS).doc(evId);
    const res = await processRideNotificationEvent({ db, messaging, eventRef, event: (await eventRef.get()).data(), context: ctx, clock });

    expect(res.status).toBe(C.NOTIFICATION_STATUS.PARTIALLY_FAILED);
    // Payload privacy: data keys are a fixed safe allowlist (no coords/pii).
    expect(Object.keys(sentMessage.data).sort()).toEqual(
      ['eventType', 'notificationId', 'offerId', 'recipientRole', 'rideId', 'route', 'traceId']
    );
    // Dead token disabled.
    expect(db._store.get(`${C.NOTIFICATION_TOKENS}/P_bad`).active).toBe(false);
    expect(db._store.get(`${C.NOTIFICATION_TOKENS}/P_good`).active).toBe(true);
    // Idempotent: re-processing the now-sent event does nothing.
    const again = await processRideNotificationEvent({ db, messaging, eventRef, event: (await eventRef.get()).data(), context: ctx, clock });
    expect(again.skipped).toBe(true);
  });
});
