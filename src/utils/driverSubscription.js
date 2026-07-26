// Driver subscription helpers (DriveLocal V1).
//
// Pure functions over an already-loaded drivers/{uid} object. No Firestore here.
// The backend remains authoritative; this module only keeps every mobile screen
// aligned with the same commercial-policy projection.

import {
  SUBSCRIPTION_MONTHLY_CENTAVOS,
  SUBSCRIPTION_PERIOD_DAYS,
} from '../constants/pricingConfig';
import {
  DAY_MS,
  SUBSCRIPTION_COVERAGE_SOURCE,
  founderSubscriptionUntilMs,
  resolveCommercialPolicy,
  toMillis as policyToMillis,
} from './commercialPolicy';

// Compatibility export used by existing screens/tests.
export function toMillis(value) {
  return policyToMillis(value);
}

// Monthly subscription price (centavos) for a vehicle type. 0 when unknown.
export function getSubscriptionMonthlyCentavos(vehicleType) {
  return SUBSCRIPTION_MONTHLY_CENTAVOS[vehicleType] || 0;
}

// Effective paid/free subscription status, computed from stored dates and `now`.
// The five-ride grace is an ELIGIBILITY source, not a fake active subscription,
// therefore it is exposed by getSubscriptionEligibility instead of this status.
export function getEffectiveSubscriptionStatus(driver, now = Date.now()) {
  const d = driver || {};
  const nowMs = toMillis(now) || Number(now) || Date.now();
  const policy = resolveCommercialPolicy(d, nowMs);
  const freeUntilMs = founderSubscriptionUntilMs(d);

  if (policy.founderFreeActive) {
    return { status: 'free', expiresAtMs: 0, freeUntilMs };
  }

  const expiresAtMs = toMillis(d.subscriptionExpiresAt);
  if (policy.paidSubscriptionActive) {
    return { status: 'active', expiresAtMs, freeUntilMs };
  }
  if (expiresAtMs > 0 || freeUntilMs > 0) {
    return { status: 'expired', expiresAtMs, freeUntilMs };
  }
  return { status: 'required', expiresAtMs: 0, freeUntilMs: 0 };
}

// True only for a real founder-free or paid subscription window. A non-founder
// five-ride grace permits offers but is deliberately not labeled as subscription.
export function hasActiveSubscription(driver, now = Date.now()) {
  const policy = resolveCommercialPolicy(driver, now);
  return policy.subscriptionCoverageSource === SUBSCRIPTION_COVERAGE_SOURCE.FOUNDER_FREE_WINDOW
    || policy.subscriptionCoverageSource === SUBSCRIPTION_COVERAGE_SOURCE.PAID_SUBSCRIPTION;
}

// Business rule: newExpiration = max(now, currentSubscriptionExpiresAt) + 30 days.
// This never makes the driver lose remaining paid days when they renew early.
export function computeRenewedExpirationMs(driver, now = Date.now()) {
  const nowMs = toMillis(now) || Number(now) || Date.now();
  const currentMs = toMillis(driver && driver.subscriptionExpiresAt);
  const base = Math.max(nowMs, currentMs);
  return base + SUBSCRIPTION_PERIOD_DAYS * DAY_MS;
}

// SINGLE SOURCE OF TRUTH for mobile subscription/trial presentation.
//
// Rules:
//   - founders #1..#100: subscription-free for 60 days from approval;
//   - drivers #101+: up to five completed rides without subscription, only inside
//     that same 60-day window;
//   - after day 60: paid subscription required for everyone;
//   - after ride five but before day 60: subscription required, commission still 0%.
export function getSubscriptionEligibility(driver, now = Date.now()) {
  const policy = resolveCommercialPolicy(driver, now);
  const sub = getEffectiveSubscriptionStatus(driver, now);

  if (policy.subscriptionCoverageSource === SUBSCRIPTION_COVERAGE_SOURCE.FOUNDER_FREE_WINDOW) {
    return {
      required: false,
      covered: true,
      reason: 'FOUNDER_COVERED',
      freeRidesRemaining: 0,
      freeRideCountUsed: policy.freeRideCountUsed,
      subscriptionStatus: 'free',
      coverageSource: policy.subscriptionCoverageSource,
      policyVersion: policy.policyVersion,
    };
  }

  if (policy.subscriptionCoverageSource === SUBSCRIPTION_COVERAGE_SOURCE.NON_FOUNDER_RIDE_GRACE) {
    return {
      required: false,
      covered: false,
      reason: 'FREE_RIDES_REMAINING',
      freeRidesRemaining: policy.freeRidesRemaining,
      freeRideCountUsed: policy.freeRideCountUsed,
      subscriptionStatus: sub.status,
      coverageSource: policy.subscriptionCoverageSource,
      policyVersion: policy.policyVersion,
    };
  }

  if (policy.subscriptionCoverageSource === SUBSCRIPTION_COVERAGE_SOURCE.PAID_SUBSCRIPTION) {
    return {
      required: false,
      covered: true,
      reason: 'SUBSCRIPTION_ACTIVE',
      freeRidesRemaining: policy.freeRidesRemaining,
      freeRideCountUsed: policy.freeRideCountUsed,
      subscriptionStatus: 'active',
      coverageSource: policy.subscriptionCoverageSource,
      policyVersion: policy.policyVersion,
    };
  }

  return {
    required: true,
    covered: false,
    reason: policy.founder ? 'FOUNDER_SUBSCRIPTION_REQUIRED' : 'SUBSCRIPTION_REQUIRED',
    freeRidesRemaining: 0,
    freeRideCountUsed: policy.freeRideCountUsed,
    subscriptionStatus: sub.status,
    coverageSource: policy.subscriptionCoverageSource,
    policyVersion: policy.policyVersion,
  };
}
