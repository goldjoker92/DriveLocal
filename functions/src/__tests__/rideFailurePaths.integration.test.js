// @ts-check
// Financial failure-path integration tests (in-memory Firestore, no cloud).
// Proves that DriveLocal never double-charges commission and that holds are
// released or retained according to the ride outcome.

const lifecycle = require('../rides/lifecycle');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const AT_18H = Date.parse('2026-07-16T21:00:00.000Z');
const CTX = { traceId: 'trace_failure_horizonte_18h', environment: 'test' };
const PASSENGER_ID = 'passenger_failure_test';
const DRIVER_ID = 'driver_failure_test';

function request(uid, data) {
  return { auth: { uid }, data };
}

function seedAssignedRide(db, rideId, over = {}) {
  db.collection(C.RIDE_REQUESTS).doc(rideId).set({
    rideId,
    passengerId: PASSENGER_ID,
    acceptedDriverId: DRIVER_ID,
    vehicleType: 'car',
    pickup: { lat: -4.10, lng: -38.49, label: 'Centro fictício' },
    destination: { lat: -4.115, lng: -38.505, label: 'Destino fictício' },
    estimatedFareCentavos: 1325,
    estimatedCommissionCentavos: 199,
    commissionHoldCentavos: 199,
    status: C.RIDE_STATUS.ASSIGNED,
    ...over,
  });
  db.collection(C.PASSENGERS).doc(PASSENGER_ID).set({ activeRideId: rideId });
  db.collection(C.DRIVERS).doc(DRIVER_ID).set({
    founderEligible: false,
    commissionFreeUntil: null,
    walletBalanceCentavos: 5000,
    walletAvailableCentavos: 4801,
    walletHeldCentavos: 199,
    activeRideId: rideId,
    completedRideCount: 5,
    freeRideCountUsed: 5,
  });
  db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_hold`).set({
    driverId: DRIVER_ID,
    rideId,
    type: 'commission_hold',
    amountCentavos: 199,
    status: 'held',
  });
}

describe('ride financial failure paths', () => {
  it('cancellation before start releases the full R$1.99 hold and charges R$0.00', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_18H);
    seedAssignedRide(db, 'ride_cancel_18h');

    await lifecycle.cancelRide({
      db,
      request: request(PASSENGER_ID, {
        rideId: 'ride_cancel_18h',
        idempotencyKey: 'cancel-horizonte-18h-1',
        reasonCode: 'mudanca_de_planos',
      }),
      context: CTX,
      clock,
    });

    const ride = db._store.get(`${C.RIDE_REQUESTS}/ride_cancel_18h`);
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    const release = db._store.get(`${C.WALLET_TRANSACTIONS}/ride_cancel_18h_release`);

    expect(ride.status).toBe(C.RIDE_STATUS.CANCELLED);
    expect(ride.commissionHoldCentavos).toBe(0);
    expect(driver.walletBalanceCentavos).toBe(5000);
    expect(driver.walletAvailableCentavos).toBe(5000);
    expect(driver.walletHeldCentavos).toBe(0);
    expect(release).toMatchObject({ amountCentavos: 199, status: 'released' });
    expect(db._store.get(`${C.WALLET_TRANSACTIONS}/ride_cancel_18h_capture`)).toBeUndefined();
  });

  it('payment dispute retains the R$1.99 hold for admin review and captures nothing', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_18H);
    seedAssignedRide(db, 'ride_dispute_18h', {
      status: C.RIDE_STATUS.PAYMENT_MARKED_SENT,
      finalFareCentavos: 1325,
      finalCommissionCentavos: 199,
    });

    await lifecycle.reportRidePaymentIssue({
      db,
      request: request(DRIVER_ID, {
        rideId: 'ride_dispute_18h',
        idempotencyKey: 'dispute-horizonte-18h1',
        reasonCode: 'pix_nao_recebido',
      }),
      context: CTX,
      clock,
    });

    const ride = db._store.get(`${C.RIDE_REQUESTS}/ride_dispute_18h`);
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);

    expect(ride.status).toBe(C.RIDE_STATUS.DISPUTED);
    expect(driver.walletBalanceCentavos).toBe(5000);
    expect(driver.walletAvailableCentavos).toBe(4801);
    expect(driver.walletHeldCentavos).toBe(199);
    expect(driver.activeRideId).toBeNull();
    expect(db._store.get(`${C.WALLET_TRANSACTIONS}/ride_dispute_18h_capture`)).toBeUndefined();
    expect(db._store.get(`${C.WALLET_TRANSACTIONS}/ride_dispute_18h_release`)).toBeUndefined();
  });

  it('duplicate driver confirmation captures commission only once', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_18H);
    seedAssignedRide(db, 'ride_duplicate_18h', {
      status: C.RIDE_STATUS.PAYMENT_MARKED_SENT,
      finalFareCentavos: 1325,
      finalCommissionCentavos: 199,
    });

    const req = request(DRIVER_ID, {
      rideId: 'ride_duplicate_18h',
      idempotencyKey: 'confirm-duplicate-18h1',
    });

    const first = await lifecycle.confirmDriverPixReceived({ db, request: req, context: CTX, clock });
    const second = await lifecycle.confirmDriverPixReceived({ db, request: req, context: CTX, clock });

    expect(first.commissionCapturedCentavos).toBe(199);
    expect(second.commissionCapturedCentavos).toBe(199);
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.walletBalanceCentavos).toBe(4801);
    expect(driver.walletAvailableCentavos).toBe(4801);
    expect(driver.walletHeldCentavos).toBe(0);
    expect(driver.completedRideCount).toBe(6);

    const capture = db._store.get(`${C.WALLET_TRANSACTIONS}/ride_duplicate_18h_capture`);
    expect(capture).toMatchObject({ amountCentavos: 199, status: 'captured' });
  });

  it('a stranger cannot confirm payment or capture the platform commission', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_18H);
    seedAssignedRide(db, 'ride_forbidden_18h', {
      status: C.RIDE_STATUS.PAYMENT_MARKED_SENT,
      finalFareCentavos: 1325,
      finalCommissionCentavos: 199,
    });

    await expect(
      lifecycle.confirmDriverPixReceived({
        db,
        request: request('other_driver', {
          rideId: 'ride_forbidden_18h',
          idempotencyKey: 'forbidden-confirm-18h1',
        }),
        context: CTX,
        clock,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.walletBalanceCentavos).toBe(5000);
    expect(driver.walletHeldCentavos).toBe(199);
    expect(db._store.get(`${C.WALLET_TRANSACTIONS}/ride_forbidden_18h_capture`)).toBeUndefined();
  });
});
