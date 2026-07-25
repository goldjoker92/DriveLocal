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
 * Normalizes Firestore Timestamp / Date / epoch-ms values to epoch-ms.
 *
 * Never use Number(timestamp) for Firestore Timestamp objects: Timestamp.valueOf
 * returns a comparison string, not epoch milliseconds. That made founder free
 * windows and paid subscriptions look expired in backend dispatch even though
 * the mobile app displayed them as active.
 *
 * @param {unknown} value
 * @returns {number}
 */
function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();

  if (typeof value === 'object') {
    const candidate = /** @type {{toMillis?:()=>number,toDate?:()=>Date,seconds?:number,nanoseconds?:number}} */ (value);

    if (typeof candidate.toMillis === 'function') {
      const millis = Number(candidate.toMillis());
      return Number.isFinite(millis) ? millis : 0;
    }

    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate();
      const millis = date instanceof Date ? date.getTime() : 0;
      return Number.isFinite(millis) ? millis : 0;
    }

    if (Number.isFinite(candidate.seconds)) {
      const nanos = Number.isFinite(candidate.nanoseconds) ? Number(candidate.nanoseconds) : 0;
      return Number(candidate.seconds) * 1000 + Math.floor(nanos / 1e6);
    }
  }

  return 0;
}

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
    financialReviewRequired: d.financialReviewRequired === true,
    riskRestrictionUntilMs: d.riskRestrictionUntilMs != null ? d.riskRestrictionUntilMs : null,
  };
}

/**
 * Authoritative ride-eligibility evaluation. Commission-free eligibility is
 * independent from subscription eligibility.
 *   - founders: subscription-covered until subscriptionFreeUntil, then need an
 *     active subscription;
 *   - non-founders: covered for their first FREE_RIDE_LIMIT rides, then need an
 *     active subscription;
 *   - unresolved payment review or an active admin risk restriction blocks NEW
 *     offers, without changing the wallet or the old ride hold.
 * @param {object} d driver document data
 * @param {{now:()=>number|Date|object}} clock
 */
function evaluateRideEligibility(d = {}, clock) {
  const rawNow = clock && typeof clock.now === 'function' ? clock.now() : Date.now();
  const now = toMillis(rawNow) || Date.now();
  const isFounder = d.founderEligible === true;
  const approved = d.verificationStatus === 'approved';
  const blocked = d.isBlocked === true;

  const commissionFreeUntilMs = toMillis(d.commissionFreeUntil);
  const subscriptionExpiresAtMs = toMillis(d.subscriptionExpiresAt);
  const subscriptionFreeUntilMs = toMillis(d.subscriptionFreeUntil || d.founderFreeUntil);
  const riskRestrictionUntilMs = toMillis(d.riskRestrictionUntilMs);

  const commissionFree = commissionFreeUntilMs > now;

  const activeSubscription =
    d.subscriptionActive === true &&
    subscriptionExpiresAtMs > now;

  const founderCovered = isFounder && subscriptionFreeUntilMs > now;

  const freeRidesRemaining = !isFounder && Number(d.freeRideCountUsed || 0) < C.FREE_RIDE_LIMIT;

  const subscriptionCovered = founderCovered || freeRidesRemaining || activeSubscription;
  const financialReviewRequired = d.financialReviewRequired === true;
  const temporaryRiskRestriction = d.riskBlockedFromNewAcceptances === true
    && (riskRestrictionUntilMs === 0 || riskRestrictionUntilMs > now);
  const riskRestricted = financialReviewRequired || temporaryRiskRestriction;

  return {
    isFounder,
    commissionFree,
    subscriptionCovered,
    requiresSubscription: !subscriptionCovered,
    financialReviewRequired,
    riskRestricted,
    // Derived on the fly — never persisted as an authoritative flag.
    canReceiveRides: approved && !blocked && !riskRestricted && subscriptionCovered,
  };
}

module.exports = { safeDriverView, evaluateRideEligibility, toMillis };
