// @ts-check

const { evaluatePassengerRideEligibility } = require('../passengers/eligibility');
const { fixedClock } = require('../time/clock');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

describe('passenger ride-request eligibility', () => {
  it('allows a normal passenger', () => {
    expect(evaluatePassengerRideEligibility({}, fixedClock(NOW))).toEqual({
      canRequestRide: true,
      permanentlyBlocked: false,
      financialReviewRequired: false,
      temporaryRestriction: false,
      restrictionUntilMs: null,
      reasonCode: null,
    });
  });

  it('blocks new rides during a temporary restriction', () => {
    const result = evaluatePassengerRideEligibility({
      riskBlockedFromNewRides: true,
      riskRestrictionUntilMs: NOW + 3600000,
    }, fixedClock(NOW));
    expect(result.canRequestRide).toBe(false);
    expect(result.reasonCode).toBe('PASSENGER_TEMPORARILY_RESTRICTED');
  });

  it('automatically stops enforcing an expired temporary restriction', () => {
    const result = evaluatePassengerRideEligibility({
      riskBlockedFromNewRides: true,
      riskRestrictionUntilMs: NOW - 1,
    }, fixedClock(NOW));
    expect(result.canRequestRide).toBe(true);
  });

  it('blocks a passenger under financial review or manually confirmed block', () => {
    expect(evaluatePassengerRideEligibility({
      financialReviewRequired: true,
    }, fixedClock(NOW)).reasonCode).toBe('PASSENGER_FINANCIAL_REVIEW_REQUIRED');

    expect(evaluatePassengerRideEligibility({
      isBlocked: true,
    }, fixedClock(NOW)).reasonCode).toBe('PASSENGER_BLOCKED');
  });
});
