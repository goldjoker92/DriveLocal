// @ts-check

const { applyPaymentReviewRestriction } = require('../risk/paymentRestriction');
const { evaluateRideEligibility } = require('../drivers/eligibility');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

describe('unresolved payment restriction', () => {
  it('blocks new acceptances while preserving approval, wallet and subscription', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc('d1').set({
      verificationStatus: 'approved',
      isBlocked: false,
      subscriptionActive: true,
      subscriptionExpiresAt: NOW + 864e5,
      founderEligible: false,
      freeRideCountUsed: 5,
      walletBalanceCentavos: 1000,
      walletAvailableCentavos: 900,
      walletHeldCentavos: 100,
    });

    await applyPaymentReviewRestriction({
      db,
      driverId: 'd1',
      rideId: 'r1',
      disputed: true,
      nowMs: NOW,
    });

    const driver = db._store.get(`${C.DRIVERS}/d1`);
    expect(driver.financialReviewRequired).toBe(true);
    expect(driver.walletBalanceCentavos).toBe(1000);
    expect(driver.walletAvailableCentavos).toBe(900);
    expect(driver.walletHeldCentavos).toBe(100);
    expect(evaluateRideEligibility(driver, fixedClock(NOW)).canReceiveRides).toBe(false);
  });

  it('clears only the restriction belonging to the resolved ride', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc('d1').set({
      verificationStatus: 'approved',
      financialReviewRequired: true,
      financialReviewRideId: 'newer-dispute',
    });

    const result = await applyPaymentReviewRestriction({
      db,
      driverId: 'd1',
      rideId: 'older-dispute',
      disputed: false,
      nowMs: NOW,
    });
    expect(result.changed).toBe(false);
    expect(db._store.get(`${C.DRIVERS}/d1`).financialReviewRequired).toBe(true);
  });

  it('restores eligibility after the matching dispute is resolved', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc('d1').set({
      verificationStatus: 'approved',
      isBlocked: false,
      subscriptionActive: true,
      subscriptionExpiresAt: NOW + 864e5,
      founderEligible: false,
      freeRideCountUsed: 5,
      financialReviewRequired: true,
      financialReviewRideId: 'r1',
    });

    await applyPaymentReviewRestriction({
      db,
      driverId: 'd1',
      rideId: 'r1',
      disputed: false,
      nowMs: NOW,
    });
    const driver = db._store.get(`${C.DRIVERS}/d1`);
    expect(driver.financialReviewRequired).toBe(false);
    expect(evaluateRideEligibility(driver, fixedClock(NOW)).canReceiveRides).toBe(true);
  });
});
