// Pure mobile mirror of the authoritative backend commercial policy.
//
// The server remains the authority for dispatch, holds and payments. This helper
// exists so every driver-facing screen explains the same dates, ride grace and
// percentages instead of duplicating business rules in components.

import {
  COMMISSION_FREE_DAYS,
  NON_FOUNDER_FREE_RIDES,
  getVehiclePricing,
} from '../constants/pricingConfig';

export const COMMERCIAL_POLICY_VERSION = 'commercial-policy-v2-2026-07';
export const DAY_MS = 24 * 60 * 60 * 1000;

export const SUBSCRIPTION_COVERAGE_SOURCE = Object.freeze({
  FOUNDER_FREE_WINDOW: 'founder_free_window',
  NON_FOUNDER_RIDE_GRACE: 'non_founder_ride_grace',
  PAID_SUBSCRIPTION: 'paid_subscription',
  NONE: 'none',
});

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  if (Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000
      + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  return 0;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function isFounderDriver(driver) {
  const d = driver || {};
  if (d.founderBadgeActive === true || d.founderEligible === true || d.isFounder === true) {
    return true;
  }
  const founderNumber = nonNegativeInteger(d.founderNumber);
  if (founderNumber > 0 && founderNumber <= 100) return true;
  const approvalNumber = nonNegativeInteger(d.approvalNumber);
  return d.founderEligible == null && approvalNumber > 0 && approvalNumber <= 100;
}

export function approvalTimeMs(driver) {
  const d = driver || {};
  return toMillis(d.approvedAtMs) || toMillis(d.approvedAt);
}

export function freePeriodUntilMs(driver) {
  const d = driver || {};
  const explicit = toMillis(d.commissionFreeUntil || d.founderExpiresAt);
  if (explicit > 0) return explicit;
  const approvedAtMs = approvalTimeMs(d);
  return approvedAtMs > 0 ? approvedAtMs + COMMISSION_FREE_DAYS * DAY_MS : 0;
}

export function founderSubscriptionUntilMs(driver) {
  const d = driver || {};
  const explicit = toMillis(
    d.subscriptionFreeUntil
    || d.founderFreeUntil
    || d.founderExpiresAt
  );
  if (explicit > 0) return explicit;
  return isFounderDriver(d) ? freePeriodUntilMs(d) : 0;
}

export function resolveCommercialPolicy(driver, nowValue = Date.now()) {
  const d = driver || {};
  const nowMs = toMillis(nowValue) || Number(nowValue) || Date.now();
  const founder = isFounderDriver(d);
  const freeUntilMs = freePeriodUntilMs(d);
  const freePeriodActive = freeUntilMs > nowMs;
  const founderFreeUntilMs = founderSubscriptionUntilMs(d);
  const founderFreeActive = founder && founderFreeUntilMs > nowMs;
  const subscriptionExpiresAtMs = toMillis(d.subscriptionExpiresAt);
  const paidSubscriptionActive = (
    d.subscriptionActive === true || d.subscriptionStatus === 'active'
  ) && subscriptionExpiresAtMs > nowMs;
  const freeRideCountUsed = Math.min(
    NON_FOUNDER_FREE_RIDES,
    nonNegativeInteger(d.freeRideCountUsed)
  );
  const freeRidesRemaining = !founder && freePeriodActive
    ? Math.max(0, NON_FOUNDER_FREE_RIDES - freeRideCountUsed)
    : 0;
  const nonFounderGraceActive = !founder && freePeriodActive && freeRidesRemaining > 0;

  let subscriptionCoverageSource = SUBSCRIPTION_COVERAGE_SOURCE.NONE;
  if (founderFreeActive) {
    subscriptionCoverageSource = SUBSCRIPTION_COVERAGE_SOURCE.FOUNDER_FREE_WINDOW;
  } else if (nonFounderGraceActive) {
    subscriptionCoverageSource = SUBSCRIPTION_COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE;
  } else if (paidSubscriptionActive) {
    subscriptionCoverageSource = SUBSCRIPTION_COVERAGE_SOURCE.PAID_SUBSCRIPTION;
  }

  const vehicleType = d.vehicleType === 'moto' ? 'moto' : d.vehicleType === 'car' ? 'car' : null;
  const standardCommissionBps = Number(
    getVehiclePricing(d.serviceAreaId, vehicleType)?.normalCommissionBps || 0
  );
  const commissionBps = freePeriodActive ? 0 : standardCommissionBps;
  const subscriptionCovered = subscriptionCoverageSource !== SUBSCRIPTION_COVERAGE_SOURCE.NONE;

  return Object.freeze({
    policyVersion: COMMERCIAL_POLICY_VERSION,
    nowMs,
    founder,
    vehicleType,
    freePeriodUntilMs: freeUntilMs,
    freePeriodActive,
    founderSubscriptionUntilMs: founderFreeUntilMs,
    founderFreeActive,
    standardCommissionBps,
    commissionBps,
    commissionPercent: commissionBps / 100,
    paidSubscriptionActive,
    subscriptionExpiresAtMs,
    subscriptionCoverageSource,
    subscriptionCovered,
    subscriptionRequired: !subscriptionCovered,
    subscriptionPaymentBlockedByGrace: founderFreeActive || nonFounderGraceActive,
    freeRideCountUsed,
    freeRideLimit: NON_FOUNDER_FREE_RIDES,
    freeRidesRemaining,
    nonFounderGraceActive,
    walletTopupRequired: !freePeriodActive,
  });
}
