// @ts-check
// Authoritative passenger eligibility for creating a NEW ride. Restrictions never
// interrupt an existing ride and never depend on a client-side flag.

const { toMillis } = require('../drivers/eligibility');

function evaluatePassengerRideEligibility(passenger = {}, clock) {
  const rawNow = clock && typeof clock.now === 'function' ? clock.now() : Date.now();
  const nowMs = toMillis(rawNow) || Date.now();
  const restrictionUntilMs = toMillis(passenger.riskRestrictionUntilMs);
  const temporaryRestriction = passenger.riskBlockedFromNewRides === true
    && (restrictionUntilMs === 0 || restrictionUntilMs > nowMs);
  const permanentlyBlocked = passenger.isBlocked === true;
  const financialReviewRequired = passenger.financialReviewRequired === true;

  let reasonCode = null;
  if (permanentlyBlocked) reasonCode = 'PASSENGER_BLOCKED';
  else if (financialReviewRequired) reasonCode = 'PASSENGER_FINANCIAL_REVIEW_REQUIRED';
  else if (temporaryRestriction) reasonCode = 'PASSENGER_TEMPORARILY_RESTRICTED';

  return {
    canRequestRide: !permanentlyBlocked && !financialReviewRequired && !temporaryRestriction,
    permanentlyBlocked,
    financialReviewRequired,
    temporaryRestriction,
    restrictionUntilMs: restrictionUntilMs || null,
    reasonCode,
  };
}

module.exports = { evaluatePassengerRideEligibility };
