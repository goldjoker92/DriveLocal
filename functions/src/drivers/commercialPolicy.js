'use strict';
// @ts-check
// Authoritative DriveLocal commercial policy for approved drivers.
//
// This module is intentionally pure: it never reads Firestore, never logs and never
// mutates a driver. Callers supply a driver snapshot and an authoritative server
// time, then persist only the result they need. Keeping the rule here prevents
// dispatch, offer acceptance, subscription payments and ride completion from
// drifting into slightly different interpretations.
//
// Final policy:
//   - every approved driver receives 60 days at 0% commission from approval;
//   - founders #1..#100 also receive subscription coverage for those 60 days;
//   - drivers #101+ may complete 5 rides without a subscription, but only inside
//     the same 60-day launch window;
//   - after the window, an active subscription is mandatory for everyone;
//   - standard commission is 12% for moto and 15% for car.

const C = require('./constants');
const { getVehiclePricing } = require('../pricing/pricing');

const COMMERCIAL_POLICY_VERSION = 'commercial-policy-v2-2026-07';

const COVERAGE_SOURCE = Object.freeze({
  FOUNDER_FREE_WINDOW: 'founder_free_window',
  NON_FOUNDER_RIDE_GRACE: 'non_founder_ride_grace',
  PAID_SUBSCRIPTION: 'paid_subscription',
  NONE: 'none',
});

/** Normalize Firestore Timestamp / Date / epoch-ms to epoch-ms. */
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
      return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
    }
    if (Number.isFinite(candidate.seconds)) {
      const nanos = Number.isFinite(candidate.nanoseconds) ? Number(candidate.nanoseconds) : 0;
      return Number(candidate.seconds) * 1000 + Math.floor(nanos / 1e6);
    }
  }
  return 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function isFounderDriver(driver = {}) {
  if (driver.founderEligible === true || driver.isFounder === true) return true;
  const founderNumber = nonNegativeInteger(driver.founderNumber);
  if (founderNumber > 0 && founderNumber <= C.FOUNDER_LIMIT) return true;

  // Compatibility for records approved before founderEligible was introduced.
  // An explicit false always wins; otherwise the first 100 approval numbers remain
  // founders according to the immutable city approval sequence.
  const approvalNumber = nonNegativeInteger(driver.approvalNumber);
  return driver.founderEligible == null
    && approvalNumber > 0
    && approvalNumber <= C.FOUNDER_LIMIT;
}

function approvalTimeMs(driver = {}) {
  return toMillis(driver.approvedAtMs) || toMillis(driver.approvedAt);
}

function freePeriodUntilMs(driver = {}) {
  const explicit = toMillis(driver.commissionFreeUntil || driver.founderExpiresAt);
  if (explicit > 0) return explicit;
  const approvedAtMs = approvalTimeMs(driver);
  return approvedAtMs > 0 ? approvedAtMs + C.FREE_PERIOD_DAYS * C.DAY_MS : 0;
}

function founderSubscriptionUntilMs(driver = {}) {
  const explicit = toMillis(
    driver.subscriptionFreeUntil
    || driver.founderFreeUntil
    || driver.founderExpiresAt
  );
  if (explicit > 0) return explicit;
  return isFounderDriver(driver) ? freePeriodUntilMs(driver) : 0;
}

function standardCommissionBps(driver = {}) {
  const vehicleType = driver.vehicleType === 'moto' ? 'moto' : driver.vehicleType === 'car' ? 'car' : null;
  if (!vehicleType) return 0;
  const pricing = getVehiclePricing(driver.serviceAreaId, vehicleType);
  return Math.max(0, nonNegativeInteger(pricing?.normalCommissionBps));
}

function paidSubscriptionActive(driver = {}, nowMs) {
  const expiresAtMs = toMillis(driver.subscriptionExpiresAt);
  const activeFlag = driver.subscriptionActive === true || driver.subscriptionStatus === 'active';
  return activeFlag && expiresAtMs > nowMs;
}

/**
 * Resolve the complete commercial state at one authoritative instant.
 * No user-controlled value can override dates, founder position, prices or rates.
 */
function resolveCommercialPolicy(driver = {}, nowValue = Date.now()) {
  const nowMs = toMillis(nowValue) || Number(nowValue) || Date.now();
  const founder = isFounderDriver(driver);
  const approvalNumber = nonNegativeInteger(driver.approvalNumber) || null;
  const freeUntilMs = freePeriodUntilMs(driver);
  const freePeriodActive = freeUntilMs > nowMs;
  const founderFreeUntilMs = founderSubscriptionUntilMs(driver);
  const founderFreeActive = founder && founderFreeUntilMs > nowMs;
  const paidActive = paidSubscriptionActive(driver, nowMs);
  const subscriptionExpiresAtMs = toMillis(driver.subscriptionExpiresAt);
  const freeRideCountUsed = Math.min(
    C.FREE_RIDE_LIMIT,
    nonNegativeInteger(driver.freeRideCountUsed)
  );
  const freeRidesRemaining = !founder && freePeriodActive
    ? Math.max(0, C.FREE_RIDE_LIMIT - freeRideCountUsed)
    : 0;
  const nonFounderGraceActive = !founder && freePeriodActive && freeRidesRemaining > 0;

  let subscriptionCoverageSource = COVERAGE_SOURCE.NONE;
  if (founderFreeActive) subscriptionCoverageSource = COVERAGE_SOURCE.FOUNDER_FREE_WINDOW;
  else if (nonFounderGraceActive) subscriptionCoverageSource = COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE;
  else if (paidActive) subscriptionCoverageSource = COVERAGE_SOURCE.PAID_SUBSCRIPTION;

  const standardBps = standardCommissionBps(driver);
  const commissionBps = freePeriodActive ? 0 : standardBps;
  const subscriptionCovered = subscriptionCoverageSource !== COVERAGE_SOURCE.NONE;

  return Object.freeze({
    policyVersion: COMMERCIAL_POLICY_VERSION,
    nowMs,
    approvalNumber,
    founder,
    vehicleType: driver.vehicleType === 'moto' ? 'moto' : driver.vehicleType === 'car' ? 'car' : null,
    freePeriodUntilMs: freeUntilMs,
    freePeriodActive,
    founderSubscriptionUntilMs: founderFreeUntilMs,
    founderFreeActive,
    standardCommissionBps: standardBps,
    commissionBps,
    commissionPercent: commissionBps / 100,
    paidSubscriptionActive: paidActive,
    subscriptionExpiresAtMs,
    subscriptionCoverageSource,
    subscriptionCovered,
    subscriptionRequired: !subscriptionCovered,
    subscriptionPaymentBlockedByGrace: founderFreeActive || nonFounderGraceActive,
    freeRideCountUsed,
    freeRideLimit: C.FREE_RIDE_LIMIT,
    freeRidesRemaining,
    nonFounderGraceActive,
    walletTopupRequired: !freePeriodActive,
  });
}

/** Internal immutable snapshot stored on an accepted ride for later settlement. */
function buildCommercialPolicySnapshot(driver = {}, nowValue = Date.now()) {
  const policy = resolveCommercialPolicy(driver, nowValue);
  return Object.freeze({
    policyVersion: policy.policyVersion,
    acceptedAtMs: policy.nowMs,
    approvalNumber: policy.approvalNumber,
    founder: policy.founder,
    vehicleType: policy.vehicleType,
    freePeriodUntilMs: policy.freePeriodUntilMs,
    commissionBpsAtAcceptance: policy.commissionBps,
    commissionFreeAtAcceptance: policy.freePeriodActive,
    subscriptionCoverageSource: policy.subscriptionCoverageSource,
    freeRideCountUsedAtAcceptance: policy.freeRideCountUsed,
    freeRideLimit: policy.freeRideLimit,
  });
}

function shouldConsumeGraceRide(policySnapshot = {}) {
  return policySnapshot.policyVersion === COMMERCIAL_POLICY_VERSION
    && policySnapshot.subscriptionCoverageSource === COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE;
}

module.exports = {
  COMMERCIAL_POLICY_VERSION,
  COVERAGE_SOURCE,
  toMillis,
  isFounderDriver,
  approvalTimeMs,
  freePeriodUntilMs,
  founderSubscriptionUntilMs,
  standardCommissionBps,
  paidSubscriptionActive,
  resolveCommercialPolicy,
  buildCommercialPolicySnapshot,
  shouldConsumeGraceRide,
};