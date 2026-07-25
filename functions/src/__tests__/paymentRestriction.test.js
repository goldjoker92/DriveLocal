// @ts-check

const {
  applyPaymentReviewRestriction,
  paymentRestrictionTransition,
  paymentReviewRideIds,
} = require('../risk/paymentRestriction');
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
    expect(driver.financialReviewRideIds).toEqual(['r1']);
    expect(driver.walletBalanceCentavos).toBe(1000);
    expect(driver.walletAvailableCentavos).toBe(900);
    expect(driver.walletHeldCentavos).toBe(100);
    expect(evaluateRideEligibility(driver, fixedClock(NOW)).canReceiveRides).toBe(false);
  });

  it('preserves another unresolved ride when one review is resolved', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc('d1').set({
      verificationStatus: 'approved',
      financialReviewRequired: true,
      financialReviewRideIds: ['older-dispute', 'newer-dispute'],
      financialReviewRideId: 'newer-dispute',
    });

    const result = await applyPaymentReviewRestriction({
      db,
      driverId: 'd1',
      rideId: 'newer-dispute',
      disputed: false,
      nowMs: NOW,
    });
    const driver = db._store.get(`${C.DRIVERS}/d1`);
    expect(result.changed).toBe(true);
    expect(result.remainingReviewCount).toBe(1);
    expect(driver.financialReviewRequired).toBe(true);
    expect(driver.financialReviewRideIds).toEqual(['older-dispute']);
    expect(driver.financialReviewRideId).toBe('older-dispute');
  });

  it('does not clear a ride that is not part of the current review set', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc('d1').set({
      verificationStatus: 'approved',
      financialReviewRequired: true,
      financialReviewRideIds: ['newer-dispute'],
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

  it('restores eligibility after the final matching review is resolved', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc('d1').set({
      verificationStatus: 'approved',
      isBlocked: false,
      subscriptionActive: true,
      subscriptionExpiresAt: NOW + 864e5,
      founderEligible: false,
      freeRideCountUsed: 5,
      financialReviewRequired: true,
      financialReviewRideIds: ['r1'],
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
    expect(driver.financialReviewRideIds).toEqual([]);
    expect(evaluateRideEligibility(driver, fixedClock(NOW)).canReceiveRides).toBe(true);
  });

  it('normalizes the legacy single-ride field into the review set', () => {
    expect(paymentReviewRideIds({
      financialReviewRideIds: ['r1'],
      financialReviewRideId: 'r2',
    })).toEqual(['r1', 'r2']);
  });

  it('clears a matching stale-payment gate on any final settlement', () => {
    expect(paymentRestrictionTransition('payment_marked_sent', 'completed')).toEqual({
      shouldHandle: true,
      restrict: false,
      enteredDispute: false,
      becameFinal: true,
    });
    expect(paymentRestrictionTransition('awaiting_payment', 'cancelled').becameFinal).toBe(true);
  });

  it('does not let a passenger dispute instantly disable a driver', () => {
    expect(paymentRestrictionTransition('payment_marked_sent', 'disputed', 'passenger')).toEqual({
      shouldHandle: false,
      restrict: false,
      enteredDispute: true,
      becameFinal: false,
    });
    expect(paymentRestrictionTransition('payment_marked_sent', 'disputed', 'driver').restrict).toBe(true);
    expect(paymentRestrictionTransition('payment_marked_sent', 'disputed').restrict).toBe(true);
  });

  it('does not react to ordinary non-financial lifecycle updates', () => {
    expect(paymentRestrictionTransition('assigned', 'driver_arrived')).toEqual({
      shouldHandle: false,
      restrict: false,
      enteredDispute: false,
      becameFinal: false,
    });
  });
});
