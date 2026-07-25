// @ts-check

const { resolveRideDispute } = require('../rides/disputeResolution');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const ADMIN = 'admin_risk_test';

function request(outcome) {
  return {
    auth: { uid: ADMIN },
    data: {
      rideId: 'old-ride',
      outcome,
      reason: 'ADMIN_PAYMENT_REVIEW',
      idempotencyKey: `resolve-${outcome}-0001`,
    },
  };
}

async function seed(db) {
  await db.collection('admins').doc(ADMIN).set({ active: true });
  await db.collection(C.RIDE_REQUESTS).doc('old-ride').set({
    rideId: 'old-ride',
    status: C.RIDE_STATUS.DISPUTED,
    passengerId: 'p1',
    acceptedDriverId: 'd1',
    commissionHoldCentavos: 150,
    finalCommissionCentavos: 120,
    estimatedCommissionCentavos: 150,
    commissionPolicySnapshot: { policyVersion: 'commission-hold-v1' },
  });
  await db.collection(C.DRIVERS).doc('d1').set({
    activeRideId: 'new-driver-ride',
    walletBalanceCentavos: 1000,
    walletAvailableCentavos: 850,
    walletHeldCentavos: 150,
    completedRideCount: 3,
    founderEligible: false,
    freeRideCountUsed: 5,
  });
  await db.collection(C.PASSENGERS).doc('p1').set({ activeRideId: 'new-passenger-ride' });
  await db.collection(C.DRIVER_OFFERS).doc('old-ride_d1').set({
    rideId: 'old-ride',
    driverId: 'd1',
    driverRideStatus: C.RIDE_STATUS.DISPUTED,
  });
  await db.collection(C.WALLET_TRANSACTIONS).doc('old-ride_hold').set({
    rideId: 'old-ride',
    driverId: 'd1',
    amountCentavos: 150,
    status: 'held',
  });
}

describe('admin dispute resolution state synchronization', () => {
  it('captures once, mirrors the offer and preserves newer active rides', async () => {
    const db = makeFakeFirestore();
    await seed(db);

    const result = await resolveRideDispute({
      db,
      request: request('confirm_driver_payment'),
      context: { traceId: 'trace_dispute_capture' },
      clock: fixedClock(NOW),
    });

    expect(result).toMatchObject({
      outcome: 'confirm_driver_payment',
      capturedCommissionCentavos: 120,
      holdReleasedCentavos: 30,
    });
    const ride = db._store.get(`${C.RIDE_REQUESTS}/old-ride`);
    const driver = db._store.get(`${C.DRIVERS}/d1`);
    const passenger = db._store.get(`${C.PASSENGERS}/p1`);
    const offer = db._store.get(`${C.DRIVER_OFFERS}/old-ride_d1`);
    expect(ride.status).toBe(C.RIDE_STATUS.COMPLETED);
    expect(driver.activeRideId).toBe('new-driver-ride');
    expect(passenger.activeRideId).toBe('new-passenger-ride');
    expect(driver.walletBalanceCentavos).toBe(880);
    expect(driver.walletAvailableCentavos).toBe(880);
    expect(driver.walletHeldCentavos).toBe(0);
    expect(offer.driverRideStatus).toBe(C.RIDE_STATUS.COMPLETED);
    expect(db._store.get(`${C.WALLET_TRANSACTIONS}/old-ride_capture`).amountCentavos).toBe(120);
  });

  it('releases the hold, mirrors cancellation and preserves newer active rides', async () => {
    const db = makeFakeFirestore();
    await seed(db);

    const result = await resolveRideDispute({
      db,
      request: request('release_driver_hold'),
      context: { traceId: 'trace_dispute_release' },
      clock: fixedClock(NOW),
    });

    expect(result).toMatchObject({
      outcome: 'release_driver_hold',
      capturedCommissionCentavos: 0,
      holdReleasedCentavos: 150,
    });
    const driver = db._store.get(`${C.DRIVERS}/d1`);
    const passenger = db._store.get(`${C.PASSENGERS}/p1`);
    const offer = db._store.get(`${C.DRIVER_OFFERS}/old-ride_d1`);
    expect(driver.activeRideId).toBe('new-driver-ride');
    expect(passenger.activeRideId).toBe('new-passenger-ride');
    expect(driver.walletBalanceCentavos).toBe(1000);
    expect(driver.walletAvailableCentavos).toBe(1000);
    expect(driver.walletHeldCentavos).toBe(0);
    expect(offer.driverRideStatus).toBe(C.RIDE_STATUS.CANCELLED);
  });
});
