'use strict';

const {
  COMMISSION_POLICY_VERSION,
  resolveHold,
  buildCommissionPolicySnapshot,
} = require('../acceptOffer');
const {
  COMMERCIAL_POLICY_VERSION,
  buildCommercialPolicySnapshot,
} = require('../../drivers/commercialPolicy');

const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVED_AT = Date.UTC(2026, 6, 1, 12, 0, 0);
const FREE_UNTIL = APPROVED_AT + 60 * DAY_MS;

function driver(overrides = {}) {
  return {
    approvalNumber: 101,
    verificationStatus: 'approved',
    founderEligible: false,
    vehicleType: 'moto',
    serviceAreaId: 'HORIZONTE_CE_BR',
    approvedAtMs: APPROVED_AT,
    commissionFreeUntil: FREE_UNTIL,
    ...overrides,
  };
}

const ride = {
  pricingConfigVersion: 'horizonte-1.1.0',
  estimatedCommissionCentavos: 144,
};

describe('commercial policy snapshots at acceptance', () => {
  it('keeps the historical resolveHold return shape', () => {
    expect(resolveHold(driver(), ride, FREE_UNTIL - 1)).toEqual({
      holdAmount: 0,
      commissionFree: true,
    });
    expect(resolveHold(driver(), ride, FREE_UNTIL)).toEqual({
      holdAmount: 144,
      commissionFree: false,
    });
  });

  it('keeps the financial hold snapshot separate from commercial eligibility', () => {
    expect(buildCommissionPolicySnapshot(ride, 144, false, FREE_UNTIL)).toEqual({
      policyVersion: COMMISSION_POLICY_VERSION,
      pricingConfigVersion: 'horizonte-1.1.0',
      estimatedCommissionCentavos: 144,
      holdAmountCentavos: 144,
      commissionFreeAtAcceptance: false,
      acceptedAtMs: FREE_UNTIL,
    });
  });

  it('freezes the 0% rate before ride completion despite old five-ride data', () => {
    const snapshot = buildCommercialPolicySnapshot(driver({ freeRideCountUsed: 5 }), FREE_UNTIL - 1);

    expect(snapshot.policyVersion).toBe(COMMERCIAL_POLICY_VERSION);
    expect(snapshot.commissionBpsAtAcceptance).toBe(0);
    expect(snapshot.commissionFreeAtAcceptance).toBe(true);
    expect(snapshot).not.toHaveProperty('freeRideLimit');
  });

  it('freezes the normal rate on day 60 regardless of a legacy paid plan', () => {
    const snapshot = buildCommercialPolicySnapshot(driver({
      freeRideCountUsed: 5,
      subscriptionActive: true,
      subscriptionExpiresAt: FREE_UNTIL + 30 * DAY_MS,
    }), FREE_UNTIL);

    expect(snapshot.commissionBpsAtAcceptance).toBe(1200);
    expect(snapshot.commissionFreeAtAcceptance).toBe(false);
  });
});
