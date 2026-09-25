const C = require('../constants');
const {
  resolveCommercialPolicy, buildCommercialPolicySnapshot, COMMERCIAL_POLICY_VERSION,
} = require('../commercialPolicy');

const approval = Date.UTC(2026, 8, 1, 12);
const end = approval + 60 * C.DAY_MS;
function driver(overrides = {}) {
  return {
    verificationStatus: 'approved', approvalNumber: 101, founderEligible: false,
    vehicleType: 'moto', serviceAreaId: 'HORIZONTE_CE_BR',
    approvedAtMs: approval, commissionFreeUntil: end,
    ...overrides,
  };
}

describe('60-day commission and founder badge', () => {
  it('keeps badges only for the first 100, without changing their commission', () => {
    const hundred = resolveCommercialPolicy(driver({ approvalNumber: 100, founderEligible: true }), end - 1);
    const next = resolveCommercialPolicy(driver({ approvalNumber: 101 }), end - 1);
    expect(hundred.founder).toBe(true);
    expect(next.founder).toBe(false);
    expect(hundred.commissionBps).toBe(0);
    expect(next.commissionBps).toBe(0);
    expect(resolveCommercialPolicy(driver({ approvalNumber: 100 }), end).founder).toBe(true);
  });

  it('requires a confirmed founder number on legacy profiles without an approval number', () => {
    expect(resolveCommercialPolicy(driver({ approvalNumber: null, founderEligible: true, founderNumber: 100 }), end).founder).toBe(true);
    expect(resolveCommercialPolicy(driver({ approvalNumber: null, founderEligible: true, founderNumber: null }), end).founder).toBe(false);
    expect(resolveCommercialPolicy(driver({ approvalNumber: null, founderEligible: true, founderNumber: 101 }), end).founder).toBe(false);
  });

  it('ignores old plan and five-ride fields, including after the fifth and after expiry', () => {
    const old = driver({
      freeRideCountUsed: 500, subscriptionActive: false, subscriptionExpiresAt: 0,
      subscriptionStatus: 'required',
    });
    const firstDay = resolveCommercialPolicy(old, approval + C.DAY_MS);
    expect(firstDay.commissionBps).toBe(0);
    const expired = resolveCommercialPolicy(old, end);
    expect(expired.commissionBps).toBe(1200);
    expect(expired).not.toHaveProperty('subscriptionRequired');
  });

  it('starts the window at approval even when a historical benefit field differs', () => {
    const afterUpdate = driver({ commissionFreeUntil: end + 60 * C.DAY_MS });
    expect(resolveCommercialPolicy(afterUpdate, end).commissionBps).toBe(1200);
    expect(resolveCommercialPolicy(afterUpdate, end - 1).freePeriodUntilMs).toBe(end);
  });

  it('charges 12% moto or 15% car on accepted rides after day 60', () => {
    expect(resolveCommercialPolicy(driver(), end).commissionBps).toBe(1200);
    expect(resolveCommercialPolicy(driver({ vehicleType: 'car' }), end).commissionBps).toBe(1500);
    const frozen = buildCommercialPolicySnapshot(driver({ vehicleType: 'car' }), end - 1);
    expect(frozen).toMatchObject({
      policyVersion: COMMERCIAL_POLICY_VERSION,
      commissionBpsAtAcceptance: 0,
      commissionFreeAtAcceptance: true,
    });
  });

  it('uses fixed server dates on older records without approvedAt', () => {
    const legacy = driver({
      approvedAtMs: null, approvedAt: null,
      commissionFreeUntil: { seconds: end / 1000, nanoseconds: 0 },
    });
    expect(resolveCommercialPolicy(legacy, end - 1).commissionBps).toBe(0);
    expect(resolveCommercialPolicy(legacy, end).commissionBps).toBe(1200);
  });
});
