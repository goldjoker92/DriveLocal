const { evaluateRideEligibility } = require('../eligibility');
const C = require('../constants');
const approvedAtMs = Date.UTC(2026, 8, 1);
const end = approvedAtMs + 60 * C.DAY_MS;
const clock = (nowMs) => ({ now: () => nowMs });
function driver(overrides = {}) {
  return {
    verificationStatus: 'approved', approvalNumber: 101, vehicleType: 'moto',
    serviceAreaId: 'HORIZONTE_CE_BR', approvedAtMs,
    isBlocked: false, financialReviewRequired: false,
    pixKeyType: 'E-mail', pixKey: 'driver@pix.test.drivelocal.local',
    ...overrides,
  };
}

describe('dispatch after plan retirement', () => {
  it('keeps driver #101 dispatchable through all 60 days regardless of past ride count', () => {
    const result = evaluateRideEligibility(driver({
      freeRideCountUsed: 5, subscriptionActive: false, subscriptionStatus: 'required',
    }), clock(end - 1));
    expect(result.canReceiveRides).toBe(true);
    expect(result.commissionBps).toBe(0);
  });
  it('keeps founder #100 and driver #101 dispatchable at day 60 with normal rates', () => {
    const founder = evaluateRideEligibility(driver({
      approvalNumber: 100, founderEligible: true, vehicleType: 'car',
    }), clock(end));
    const next = evaluateRideEligibility(driver(), clock(end));
    expect(founder.canReceiveRides).toBe(true);
    expect(founder.commissionBps).toBe(1500);
    expect(founder.isFounder).toBe(true);
    expect(next.canReceiveRides).toBe(true);
    expect(next.commissionBps).toBe(1200);
  });
  it('still rejects risk, blocked, invalid Pix and unapproved drivers', () => {
    for (const override of [
      { isBlocked: true }, { financialReviewRequired: true },
      { pixKey: null }, { verificationStatus: 'pending_review' },
    ]) {
      expect(evaluateRideEligibility(driver(override), clock(end)).canReceiveRides).toBe(false);
    }
  });
});
