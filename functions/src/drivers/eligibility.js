// @ts-check
// Read-side derivations for the secure driver domain:
//   - safeDriverView: the ONLY driver fields ever returned to a client (no CPF,
//     Pix key, documents, or raw financial ledger);
//   - evaluateRideEligibility: the single authoritative backend evaluator for
//     whether an approved driver may currently receive rides.
//
// canReceiveRides is COMPUTED here on demand and is never stored as a
// client-authoritative flag.

const C = require('./constants');

/**
 * Minimal, safe projection of a driver document for callable responses.
 * @param {string} driverId
 * @param {object} d driver document data
 */
function safeDriverView(driverId, d = {}) {
  return {
    driverId,
    verificationStatus: d.verificationStatus != null ? d.verificationStatus : null,
    approvalNumber: d.approvalNumber != null ? d.approvalNumber : null,
    founderEligible: d.founderEligible === true,
    founderNumber: d.founderNumber != null ? d.founderNumber : null,
    approvedAtMs: d.approvedAtMs != null ? d.approvedAtMs : null,
    commissionFreeUntil: d.commissionFreeUntil != null ? d.commissionFreeUntil : null,
    subscriptionFreeUntil: d.subscriptionFreeUntil != null ? d.subscriptionFreeUntil : null,
    subscriptionActive: d.subscriptionActive === true,
    subscriptionExpiresAt: d.subscriptionExpiresAt != null ? d.subscriptionExpiresAt : null,
    isBlocked: d.isBlocked === true,
  };
}

/**
 * Authoritative ride-eligibility evaluation. Commission-free eligibility is
 * independent from subscription eligibility.
 *   - founders: subscription-covered until subscriptionFreeUntil, then need an
 *     active subscription;
 *   - non-founders: covered for their first FREE_RIDE_LIMIT rides, then need an
 *     active subscription.
 * @param {object} d driver document data
 * @param {{now:()=>number}} clock
 */
function evaluateRideEligibility(d = {}, clock) {
  const now = clock.now();
  const isFounder = d.founderEligible === true;
  const approved = d.verificationStatus === 'approved';
  const blocked = d.isBlocked === true;

  const commissionFree = d.commissionFreeUntil != null && Number(d.commissionFreeUntil) > now;

  const activeSubscription =
    d.subscriptionActive === true &&
    d.subscriptionExpiresAt != null &&
    Number(d.subscriptionExpiresAt) > now;

  const founderCovered =
    isFounder && d.subscriptionFreeUntil != null && Number(d.subscriptionFreeUntil) > now;

  const freeRidesRemaining = !isFounder && Number(d.freeRideCountUsed || 0) < C.FREE_RIDE_LIMIT;

  const subscriptionCovered = founderCovered || freeRidesRemaining || activeSubscription;

  return {
    isFounder,
    commissionFree,
    subscriptionCovered,
    requiresSubscription: !subscriptionCovered,
    // Derived on the fly — never persisted as an authoritative flag.
    canReceiveRides: approved && !blocked && subscriptionCovered,
  };
}

module.exports = { safeDriverView, evaluateRideEligibility };
