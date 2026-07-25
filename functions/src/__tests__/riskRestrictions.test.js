// @ts-check

const {
  addTemporaryRestriction,
  removeTemporaryRestriction,
  activeRiskRestrictionState,
} = require('../risk/restrictions');
const { evaluateRideEligibility } = require('../drivers/eligibility');
const { evaluatePassengerRideEligibility } = require('../passengers/eligibility');
const { fixedClock } = require('../time/clock');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

describe('overlapping temporary risk restrictions', () => {
  it('keeps the longest active case when a shorter case is added later', () => {
    const first = addTemporaryRestriction({}, 'case-long', NOW + 72 * 3600000, NOW);
    const second = addTemporaryRestriction({ riskRestrictions: first }, 'case-short', NOW + 3600000, NOW);
    const state = activeRiskRestrictionState({
      riskRestrictions: second,
      riskBlockedFromNewAcceptances: true,
    }, NOW + 2 * 3600000);

    expect(state.active).toBe(true);
    expect(state.caseId).toBe('case-long');
    expect(state.untilMs).toBe(NOW + 72 * 3600000);
  });

  it('removing one case does not unlock another active case', () => {
    const restrictions = [
      { caseId: 'case-a', untilMs: NOW + 24 * 3600000 },
      { caseId: 'case-b', untilMs: NOW + 48 * 3600000 },
    ];
    const remaining = removeTemporaryRestriction({ riskRestrictions: restrictions }, 'case-b', NOW);
    expect(remaining).toEqual([{ caseId: 'case-a', untilMs: NOW + 24 * 3600000 }]);
    expect(activeRiskRestrictionState({
      riskRestrictions: remaining,
      riskBlockedFromNewRides: true,
    }, NOW).active).toBe(true);
  });

  it('expires restrictions dynamically without needing a cleanup write', () => {
    const profile = {
      riskRestrictions: [{ caseId: 'case-a', untilMs: NOW + 3600000 }],
      riskBlockedFromNewRides: true,
    };
    expect(activeRiskRestrictionState(profile, NOW).active).toBe(true);
    expect(activeRiskRestrictionState(profile, NOW + 3600001).active).toBe(false);
  });

  it('blocks both driver acceptances and passenger requests while active', () => {
    const restrictions = [{ caseId: 'case-a', untilMs: NOW + 3600000 }];
    const driver = {
      verificationStatus: 'approved',
      founderEligible: false,
      freeRideCountUsed: 0,
      riskRestrictions: restrictions,
      riskBlockedFromNewAcceptances: true,
    };
    const passenger = {
      riskRestrictions: restrictions,
      riskBlockedFromNewRides: true,
    };

    expect(evaluateRideEligibility(driver, fixedClock(NOW)).canReceiveRides).toBe(false);
    expect(evaluatePassengerRideEligibility(passenger, fixedClock(NOW)).canRequestRide).toBe(false);
  });
});
