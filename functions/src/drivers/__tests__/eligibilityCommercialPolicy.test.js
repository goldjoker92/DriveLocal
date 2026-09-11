'use strict';

const { evaluateRideEligibility } = require('../eligibility');
const C = require('../constants');

const APPROVED_AT = Date.UTC(2026, 6, 1, 12, 0, 0);
const FREE_UNTIL = APPROVED_AT + C.FREE_PERIOD_DAYS * C.DAY_MS;

function clock(nowMs) {
  return { now: () => nowMs };
}

function driver(overrides = {}) {
  return {
    verificationStatus: 'approved',
    approvalNumber: 101,
    founderEligible: false,
    vehicleType: 'moto',
    serviceAreaId: 'HORIZONTE_CE_BR',
    approvedAtMs: APPROVED_AT,
    commissionFreeUntil: FREE_UNTIL,
    subscriptionActive: false,
    subscriptionExpiresAt: 0,
    freeRideCountUsed: 0,
    isBlocked: false,
    pixKeyType: 'E-mail',
    pixKey: 'commercial_driver@pix.test.drivelocal.local',
    financialReviewRequired: false,
    ...overrides,
  };
}

describe('dispatch eligibility commercial integration', () => {
  it('allows the fifth no-subscription ride for driver #101+', () => {
    const result = evaluateRideEligibility(
      driver({ freeRideCountUsed: 4 }),
      clock(FREE_UNTIL - 1)
    );

    expect(result.canReceiveRides).toBe(true);
    expect(result.requiresSubscription).toBe(false);
    expect(result.freeRidesRemaining).toBe(1);
    expect(result.commissionBps).toBe(0);
  });

  it('blocks the sixth offer but keeps 0% until day 60', () => {
    const result = evaluateRideEligibility(
      driver({ freeRideCountUsed: 5 }),
      clock(FREE_UNTIL - 1)
    );

    expect(result.canReceiveRides).toBe(false);
    expect(result.requiresSubscription).toBe(true);
    expect(result.freeRidesRemaining).toBe(0);
    expect(result.commissionBps).toBe(0);
  });

  it('blocks at day 60 even when grace rides remain', () => {
    const result = evaluateRideEligibility(
      driver({ freeRideCountUsed: 1 }),
      clock(FREE_UNTIL)
    );

    expect(result.canReceiveRides).toBe(false);
    expect(result.requiresSubscription).toBe(true);
    expect(result.commissionBps).toBe(1200);
  });

  it('allows an active paid subscription after day 60 with 12% moto', () => {
    const now = FREE_UNTIL + C.DAY_MS;
    const result = evaluateRideEligibility(driver({
      freeRideCountUsed: 1,
      subscriptionActive: true,
      subscriptionExpiresAt: now + 30 * C.DAY_MS,
    }), clock(now));

    expect(result.canReceiveRides).toBe(true);
    expect(result.subscriptionCoverageSource).toBe('paid_subscription');
    expect(result.commissionBps).toBe(1200);
  });

  it('allows founder #100 through day 59 and blocks without subscription at day 60', () => {
    const founder = driver({
      approvalNumber: 100,
      founderEligible: true,
      founderNumber: 100,
      subscriptionFreeUntil: FREE_UNTIL,
      freeRideCountUsed: 5,
    });

    expect(evaluateRideEligibility(founder, clock(FREE_UNTIL - 1)).canReceiveRides).toBe(true);
    const expired = evaluateRideEligibility(founder, clock(FREE_UNTIL));
    expect(expired.canReceiveRides).toBe(false);
    expect(expired.requiresSubscription).toBe(true);
  });

  it('keeps risk and moderation blockers stronger than commercial coverage', () => {
    const result = evaluateRideEligibility(driver({
      subscriptionActive: true,
      subscriptionExpiresAt: FREE_UNTIL + 30 * C.DAY_MS,
      financialReviewRequired: true,
    }), clock(FREE_UNTIL + C.DAY_MS));

    expect(result.subscriptionCovered).toBe(true);
    expect(result.riskRestricted).toBe(true);
    expect(result.canReceiveRides).toBe(false);
  });
});
