// @ts-check
// Authoritative passenger eligibility for creating a NEW ride. Restrictions never
// interrupt an existing ride and never depend on a client-side flag.

const { toMillis } = require('../drivers/eligibility');
const { activeRiskRestrictionState } = require('../risk/restrictions');

function evaluatePassengerRideEligibility(passenger = {}, clock) {
  const rawNow = clock && typeof clock.now === 'function' ? clock.now() : Date.now();
  const nowMs = toMillis(rawNow) || Date.now();
  const restriction = activeRiskRestrictionState(passenger, nowMs);
  const permanentlyBlocked = passenger.isBlocked === true;
  const financialReviewRequired = passenger.financialReviewRequired === true;

  let reasonCode = null;
  if (permanentlyBlocked) reasonCode = 'PASSENGER_BLOCKED';
  else if (financialReviewRequired) reasonCode = 'PASSENGER_FINANCIAL_REVIEW_REQUIRED';
  else if (restriction.active) reasonCode = 'PASSENGER_TEMPORARILY_RESTRICTED';

  return {
    canRequestRide: !permanentlyBlocked && !financialReviewRequired && !restriction.active,
    permanentlyBlocked,
    financialReviewRequired,
    temporaryRestriction: restriction.active,
    restrictionUntilMs: restriction.untilMs,
    reasonCode,
  };
}

module.exports = { evaluatePassengerRideEligibility };
