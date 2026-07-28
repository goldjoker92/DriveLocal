'use strict';

const C = require('../constants');
const {
  COMMERCIAL_POLICY_VERSION,
  COVERAGE_SOURCE,
  resolveCommercialPolicy,
  buildCommercialPolicySnapshot,
  shouldConsumeGraceRide,
} = require('../commercialPolicy');

const DAY_MS = C.DAY_MS;
const APPROVED_AT = Date.UTC(2026, 6, 1, 12, 0, 0);
const FREE_UNTIL = APPROVED_AT + C.FREE_PERIOD_DAYS * DAY_MS;

function driver(overrides = {}) {
  return {
    verificationStatus: 'approved',
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

describe('authoritative commercial policy', () => {
  it('gives every approved driver 0% commission for 60 days', () => {
    const founder = resolveCommercialPolicy(driver({
      approvalNumber: 100,
      founderEligible: true,
      founderNumber: 100,
      subscriptionFreeUntil: FREE_UNTIL,
    }), APPROVED_AT + 10 * DAY_MS);
    const nonFounder = resolveCommercialPolicy(driver(), APPROVED_AT + 10 * DAY_MS);

    expect(founder.commissionBps).toBe(0);
    expect(nonFounder.commissionBps).toBe(0);
    expect(founder.freePeriodUntilMs).toBe(FREE_UNTIL);
    expect(nonFounder.freePeriodUntilMs).toBe(FREE_UNTIL);
  });

  it('covers founders #1..#100 by subscription for the full launch window', () => {
    const policy = resolveCommercialPolicy(driver({
      approvalNumber: 100,
      founderEligible: true,
      founderNumber: 100,
      subscriptionFreeUntil: FREE_UNTIL,
      freeRideCountUsed: 5,
    }), FREE_UNTIL - 1);

    expect(policy.founder).toBe(true);
    expect(policy.subscriptionCoverageSource).toBe(COVERAGE_SOURCE.FOUNDER_FREE_WINDOW);
    expect(policy.subscriptionRequired).toBe(false);
    expect(policy.freeRidesRemaining).toBe(0);
  });

  it('allows drivers #101+ five completed rides without subscription inside 60 days', () => {
    const first = resolveCommercialPolicy(driver({ freeRideCountUsed: 0 }), APPROVED_AT + DAY_MS);
    const fifthAvailable = resolveCommercialPolicy(driver({ freeRideCountUsed: 4 }), APPROVED_AT + DAY_MS);
    const sixthBlocked = resolveCommercialPolicy(driver({ freeRideCountUsed: 5 }), APPROVED_AT + DAY_MS);

    expect(first.subscriptionCoverageSource).toBe(COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE);
    expect(first.freeRidesRemaining).toBe(5);
    expect(fifthAvailable.freeRidesRemaining).toBe(1);
    expect(fifthAvailable.subscriptionRequired).toBe(false);
    expect(sixthBlocked.freeRidesRemaining).toBe(0);
    expect(sixthBlocked.subscriptionRequired).toBe(true);
  });

  it('requires subscription after day 60 even when fewer than five rides were used', () => {
    const policy = resolveCommercialPolicy(driver({ freeRideCountUsed: 2 }), FREE_UNTIL);

    expect(policy.freePeriodActive).toBe(false);
    expect(policy.freeRidesRemaining).toBe(0);
    expect(policy.subscriptionCoverageSource).toBe(COVERAGE_SOURCE.NONE);
    expect(policy.subscriptionRequired).toBe(true);
  });

  it('keeps commission at 0% after the fifth ride until day 60', () => {
    const policy = resolveCommercialPolicy(driver({ freeRideCountUsed: 5 }), FREE_UNTIL - 1);

    expect(policy.subscriptionRequired).toBe(true);
    expect(policy.commissionBps).toBe(0);
    expect(policy.commissionPercent).toBe(0);
  });

  it('applies 12% moto and 15% car after the free period', () => {
    const moto = resolveCommercialPolicy(driver({ vehicleType: 'moto' }), FREE_UNTIL + 1);
    const car = resolveCommercialPolicy(driver({ vehicleType: 'car' }), FREE_UNTIL + 1);

    expect(moto.standardCommissionBps).toBe(1200);
    expect(moto.commissionBps).toBe(1200);
    expect(moto.commissionPercent).toBe(12);
    expect(car.standardCommissionBps).toBe(1500);
    expect(car.commissionBps).toBe(1500);
    expect(car.commissionPercent).toBe(15);
  });

  it('accepts an active paid subscription after launch grace ends', () => {
    const now = FREE_UNTIL + DAY_MS;
    const policy = resolveCommercialPolicy(driver({
      freeRideCountUsed: 1,
      subscriptionActive: true,
      subscriptionExpiresAt: now + 30 * DAY_MS,
    }), now);

    expect(policy.subscriptionCoverageSource).toBe(COVERAGE_SOURCE.PAID_SUBSCRIPTION);
    expect(policy.subscriptionRequired).toBe(false);
  });

  it('derives the free-period end from approvedAt for compatible old records', () => {
    const policy = resolveCommercialPolicy(driver({
      commissionFreeUntil: null,
      approvedAtMs: APPROVED_AT,
    }), APPROVED_AT + DAY_MS);

    expect(policy.freePeriodUntilMs).toBe(FREE_UNTIL);
    expect(policy.freePeriodActive).toBe(true);
  });

  it('normalizes Firestore-like timestamp values', () => {
    const policy = resolveCommercialPolicy(driver({
      commissionFreeUntil: { seconds: Math.floor(FREE_UNTIL / 1000), nanoseconds: 0 },
      subscriptionExpiresAt: { toMillis: () => FREE_UNTIL + DAY_MS },
      subscriptionActive: true,
      freeRideCountUsed: 5,
    }), FREE_UNTIL - 1);

    expect(policy.freePeriodUntilMs).toBe(FREE_UNTIL);
    expect(policy.paidSubscriptionActive).toBe(true);
  });

  it('freezes the acceptance source so only a grace ride consumes the counter', () => {
    const graceSnapshot = buildCommercialPolicySnapshot(driver({ freeRideCountUsed: 4 }), FREE_UNTIL - 1);
    const paidSnapshot = buildCommercialPolicySnapshot(driver({
      freeRideCountUsed: 5,
      subscriptionActive: true,
      subscriptionExpiresAt: FREE_UNTIL + 30 * DAY_MS,
    }), FREE_UNTIL - 1);

    expect(graceSnapshot.policyVersion).toBe(COMMERCIAL_POLICY_VERSION);
    expect(graceSnapshot.subscriptionCoverageSource).toBe(COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE);
    expect(shouldConsumeGraceRide(graceSnapshot)).toBe(true);
    expect(shouldConsumeGraceRide(paidSnapshot)).toBe(false);
    expect(shouldConsumeGraceRide({
      policyVersion: 'legacy',
      subscriptionCoverageSource: COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE,
    })).toBe(false);
  });
});