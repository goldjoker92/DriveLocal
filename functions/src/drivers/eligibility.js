// @ts-check
// Read-side derivations for the secure driver domain:
//   - safeDriverView: the ONLY driver fields ever returned to a client (no CPF,
//     Pix key, documents, or raw financial ledger);
//   - evaluateRideEligibility: the single authoritative backend evaluator for
//     whether an approved driver may currently receive rides.
//
// canReceiveRides is COMPUTED here on demand and is never stored as a
// client-authoritative flag. Commercial dates and rates come
// exclusively from commercialPolicy.js so dispatch and acceptance cannot diverge.

const { activeRiskRestrictionState } = require('../risk/restrictions');
const { resolveCommercialPolicy, toMillis } = require('./commercialPolicy');
const { normalizePixKey } = require('../pix/pixKey');

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
    isBlocked: d.isBlocked === true,
    financialReviewRequired: d.financialReviewRequired === true,
    riskRestrictionUntilMs: d.riskRestrictionUntilMs != null ? d.riskRestrictionUntilMs : null,
  };
}

/**
 * Authoritative ride-eligibility evaluation.
 *
 * Commercial invariants:
 *   - all drivers are at 0% commission for 60 days from approval;
 *   - founders #1..#100 keep the badge without a financial exception;
 *   - thereafter 12% moto or 15% car is charged on completed paid rides.
 *
 * Unresolved payment review or an active admin risk restriction blocks NEW
 * offers without changing an accepted ride or its frozen financial snapshot.
 *
 * @param {object} d driver document data
 * @param {{now:()=>number|Date|object}} clock
 */
function evaluateRideEligibility(d = {}, clock) {
  const rawNow = clock && typeof clock.now === 'function' ? clock.now() : Date.now();
  const now = toMillis(rawNow) || Date.now();
  const commercial = resolveCommercialPolicy(d, now);
  const approved = d.verificationStatus === 'approved';
  const blocked = d.isBlocked === true;
  const financialReviewRequired = d.financialReviewRequired === true;
  const temporaryRestriction = activeRiskRestrictionState(d, now);
  const riskRestricted = financialReviewRequired || temporaryRestriction.active;
  const pixKeyValidation = normalizePixKey(d.pixKey, d.pixKeyType);

  return {
    isFounder: commercial.founder,
    commissionFree: commercial.freePeriodActive,
    commissionBps: commercial.commissionBps,
    standardCommissionBps: commercial.standardCommissionBps,
    freePeriodUntilMs: commercial.freePeriodUntilMs,
    commercialPolicyVersion: commercial.policyVersion,
    financialReviewRequired,
    riskRestricted,
    riskRestrictionUntilMs: temporaryRestriction.untilMs,
    pixKeyValid: pixKeyValidation.valid,
    pixKeyReasonCode: pixKeyValidation.reasonCode,
    // Derived on the fly — never persisted as an authoritative flag.
    canReceiveRides:
      approved
      && !blocked
      && !riskRestricted
      && pixKeyValidation.valid,
  };
}

module.exports = { safeDriverView, evaluateRideEligibility, toMillis };
