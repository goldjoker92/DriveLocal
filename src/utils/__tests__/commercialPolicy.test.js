const {
  COMMERCIAL_POLICY_VERSION,
  resolveCommercialPolicy,
} = require('../commercialPolicy');
const {
  commissionDisplay,
  commissionFreeUntilMs,
} = require('../driverCockpit');

const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVED_AT = Date.UTC(2026, 6, 1, 12, 0, 0);

function driver(overrides = {}) {
  return {
    verificationStatus: 'approved', approvalNumber: 101,
    vehicleType: 'moto', serviceAreaId: 'HORIZONTE_CE_BR',
    approvedAtMs: APPROVED_AT,
    ...overrides,
  };
}

describe('mobile commercial policy mirror', () => {
  it('keeps the driver cockpit render-safe while the profile is still loading', () => {
    const policy = resolveCommercialPolicy(null, APPROVED_AT);

    expect(policy.freePeriodActive).toBe(false);
    expect(policy.commissionBps).toBe(0);
    expect(commissionDisplay(null, APPROVED_AT)).toMatchObject({
      mode: 'standard',
      label: '0%',
      bps: 0,
    });
    expect(commissionFreeUntilMs(null)).toBe(0);
  });

  it('grants #100 and #101 the same 60 days, regardless of historical fields', () => {
    for (const approvalNumber of [100, 101]) {
      const profile = driver({
        approvalNumber, founderEligible: approvalNumber === 100,
        commissionFreeUntil: APPROVED_AT + 7 * DAY_MS,
        subscriptionActive: false, freeRideCountUsed: 99,
      });
      const policy = resolveCommercialPolicy(profile, APPROVED_AT + 59 * DAY_MS);
      expect(policy.policyVersion).toBe(COMMERCIAL_POLICY_VERSION);
      expect(policy.founder).toBe(approvalNumber === 100);
      expect(policy.freePeriodActive).toBe(true);
      expect(policy.commissionBps).toBe(0);
      expect(commissionDisplay(profile, APPROVED_AT + 59 * DAY_MS).label).toBe('0%');
    }
  });

  it('charges 12% moto and 15% car from day 60; the founder badge remains', () => {
    const day60 = APPROVED_AT + 60 * DAY_MS;
    const founder = resolveCommercialPolicy(driver({ approvalNumber: 100 }), day60);
    expect(founder.founder).toBe(true);
    expect(founder.commissionBps).toBe(1200);
    expect(commissionDisplay(driver({ vehicleType: 'moto' }), day60).label).toBe('12%');
    expect(commissionDisplay(driver({ vehicleType: 'car' }), day60).label).toBe('15%');
  });

  it('shows the legacy badge only when its recorded founder number is within the first 100', () => {
    const oldProfile = { approvalNumber: null, founderEligible: true };
    expect(resolveCommercialPolicy(driver({ ...oldProfile, founderNumber: 100 }), APPROVED_AT).founder).toBe(true);
    expect(resolveCommercialPolicy(driver({ ...oldProfile, founderNumber: null }), APPROVED_AT).founder).toBe(false);
    expect(resolveCommercialPolicy(driver({ ...oldProfile, founderNumber: 101 }), APPROVED_AT).founder).toBe(false);
  });
});
