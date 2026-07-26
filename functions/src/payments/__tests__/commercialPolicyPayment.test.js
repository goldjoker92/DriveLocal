'use strict';

const C = require('../../drivers/constants');
const { subscriptionAlreadyCovered } = require('../createPixPayment');

const DAY_MS = C.DAY_MS;
const APPROVED_AT = Date.UTC(2026, 6, 1, 12, 0, 0);
const FREE_UNTIL = APPROVED_AT + C.FREE_PERIOD_DAYS * DAY_MS;

function driver(overrides = {}) {
  return {
    approvalNumber: 101,
    founderEligible: false,
    vehicleType: 'moto',
    serviceAreaId: 'HORIZONTE_CE_BR',
    approvedAtMs: APPROVED_AT,
    commissionFreeUntil: FREE_UNTIL,
    subscriptionFreeUntil: null,
    subscriptionActive: false,
    subscriptionExpiresAt: 0,
    freeRideCountUsed: 0,
    ...overrides,
  };
}

describe('driver Pix payment commercial gates', () => {
  it('blocks a founder subscription payment during the 60-day free window', () => {
    expect(subscriptionAlreadyCovered(driver({
      approvalNumber: 100,
      founderEligible: true,
      founderNumber: 100,
      subscriptionFreeUntil: FREE_UNTIL,
    }), FREE_UNTIL - 1)).toBe(true);
  });

  it('blocks #101+ subscription payment while a grace ride remains inside 60 days', () => {
    expect(subscriptionAlreadyCovered(driver({ freeRideCountUsed: 4 }), FREE_UNTIL - 1))
      .toBe(true);
  });

  it('allows subscription payment immediately after the fifth ride', () => {
    expect(subscriptionAlreadyCovered(driver({ freeRideCountUsed: 5 }), FREE_UNTIL - 1))
      .toBe(false);
  });

  it('allows subscription payment at day 60 even when grace rides remain', () => {
    expect(subscriptionAlreadyCovered(driver({ freeRideCountUsed: 2 }), FREE_UNTIL))
      .toBe(false);
  });

  it('allows early paid renewal because a paid subscription is not launch grace', () => {
    expect(subscriptionAlreadyCovered(driver({
      freeRideCountUsed: 5,
      subscriptionActive: true,
      subscriptionExpiresAt: FREE_UNTIL + 30 * DAY_MS,
    }), FREE_UNTIL + DAY_MS)).toBe(false);
  });

  it('normalizes Firestore Timestamp-like dates instead of Number(timestamp)', () => {
    expect(subscriptionAlreadyCovered(driver({
      freeRideCountUsed: 4,
      commissionFreeUntil: { seconds: Math.floor(FREE_UNTIL / 1000), nanoseconds: 0 },
    }), FREE_UNTIL - 1)).toBe(true);
  });
});
