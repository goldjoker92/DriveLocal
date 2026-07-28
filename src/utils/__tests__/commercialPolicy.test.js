const {
  COMMERCIAL_POLICY_VERSION,
  SUBSCRIPTION_COVERAGE_SOURCE,
  resolveCommercialPolicy,
} = require('../commercialPolicy');
const {
  getSubscriptionEligibility,
  getEffectiveSubscriptionStatus,
} = require('../driverSubscription');
const { commissionDisplay, subscriptionDisplay } = require('../driverCockpit');

const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVED_AT = Date.UTC(2026, 6, 1, 12, 0, 0);
const FREE_UNTIL = APPROVED_AT + 60 * DAY_MS;

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

describe('mobile commercial policy mirror', () => {
  it('matches the versioned 60-day rule', () => {
    const policy = resolveCommercialPolicy(driver(), APPROVED_AT + DAY_MS);
    expect(policy.policyVersion).toBe(COMMERCIAL_POLICY_VERSION);
    expect(policy.freePeriodActive).toBe(true);
    expect(policy.commissionBps).toBe(0);
    expect(policy.commissionPercent).toBe(0);
  });

  it('keeps founder #100 subscription-free through day 60', () => {
    const policy = resolveCommercialPolicy(driver({
      approvalNumber: 100,
      founderEligible: true,
      founderNumber: 100,
      subscriptionFreeUntil: FREE_UNTIL,
      freeRideCountUsed: 5,
    }), FREE_UNTIL - 1);

    expect(policy.subscriptionCoverageSource)
      .toBe(SUBSCRIPTION_COVERAGE_SOURCE.FOUNDER_FREE_WINDOW);
    expect(policy.subscriptionRequired).toBe(false);
    expect(subscriptionDisplay({
      ...driver(),
      approvalNumber: 100,
      founderEligible: true,
      subscriptionFreeUntil: FREE_UNTIL,
    }, FREE_UNTIL - 1).mode).toBe('free');
  });

  it('allows five rides for #101+ only inside the 60-day window', () => {
    const fourthUsed = getSubscriptionEligibility(
      driver({ freeRideCountUsed: 4 }),
      FREE_UNTIL - 1
    );
    const fifthUsed = getSubscriptionEligibility(
      driver({ freeRideCountUsed: 5 }),
      FREE_UNTIL - 1
    );
    const expiredWithRidesLeft = getSubscriptionEligibility(
      driver({ freeRideCountUsed: 2 }),
      FREE_UNTIL
    );

    expect(fourthUsed.required).toBe(false);
    expect(fourthUsed.freeRidesRemaining).toBe(1);
    expect(fourthUsed.coverageSource)
      .toBe(SUBSCRIPTION_COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE);
    expect(fifthUsed.required).toBe(true);
    expect(expiredWithRidesLeft.required).toBe(true);
    expect(expiredWithRidesLeft.freeRidesRemaining).toBe(0);
  });

  it('keeps commission at 0% after ride five until the date expires', () => {
    const policy = resolveCommercialPolicy(
      driver({ freeRideCountUsed: 5 }),
      FREE_UNTIL - 1
    );
    expect(policy.subscriptionRequired).toBe(true);
    expect(policy.commissionBps).toBe(0);
    expect(commissionDisplay(driver({ freeRideCountUsed: 5 }), FREE_UNTIL - 1).label)
      .toBe('0%');
  });

  it('shows 12% for moto and 15% for car after day 60', () => {
    expect(commissionDisplay(driver({ vehicleType: 'moto' }), FREE_UNTIL).label).toBe('12%');
    expect(commissionDisplay(driver({ vehicleType: 'car' }), FREE_UNTIL).label).toBe('15%');
  });

  it('distinguishes ride grace from a real active subscription', () => {
    const grace = getEffectiveSubscriptionStatus(driver(), APPROVED_AT + DAY_MS);
    const eligibility = getSubscriptionEligibility(driver(), APPROVED_AT + DAY_MS);

    expect(grace.status).toBe('required');
    expect(eligibility.required).toBe(false);
    expect(eligibility.reason).toBe('FREE_RIDES_REMAINING');
    expect(subscriptionDisplay(driver(), APPROVED_AT + DAY_MS).mode).toBe('ride_grace');
  });

  it('accepts a paid subscription after the launch window', () => {
    const now = FREE_UNTIL + DAY_MS;
    const policy = resolveCommercialPolicy(driver({
      subscriptionActive: true,
      subscriptionExpiresAt: now + 30 * DAY_MS,
      freeRideCountUsed: 2,
    }), now);

    expect(policy.subscriptionCoverageSource)
      .toBe(SUBSCRIPTION_COVERAGE_SOURCE.PAID_SUBSCRIPTION);
    expect(policy.subscriptionRequired).toBe(false);
  });
});