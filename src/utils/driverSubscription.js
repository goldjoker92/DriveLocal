// Driver subscription helpers (DriveLocal V1).
//
// Pure functions over an already-loaded drivers/{uid} object. No Firestore here.
//
// Business rule: the EFFECTIVE subscription status is calculated at read time
// from subscriptionExpiresAt and `now`. Do NOT rely on a cron to flip
// active -> expired. A stored subscriptionStatus may exist, but treat it as a
// cache/display value only — this function is the source of truth.

import {
  SUBSCRIPTION_MONTHLY_CENTAVOS,
  SUBSCRIPTION_PERIOD_DAYS,
  NON_FOUNDER_FREE_RIDES,
} from '../constants/pricingConfig';

const DAY_MS = 24 * 60 * 60 * 1000;

// Normalizes a Firestore Timestamp / Date / epoch-ms to epoch-ms (0 if absent).
export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

// Monthly subscription price (centavos) for a vehicle type. 0 when unknown.
export function getSubscriptionMonthlyCentavos(vehicleType) {
  return SUBSCRIPTION_MONTHLY_CENTAVOS[vehicleType] || 0;
}

// Effective subscription status, computed from stored dates and `now`.
//
// Returns { status, expiresAtMs, freeUntilMs } where status is one of:
//   'free'     -> inside the free launch window (founder or 60-day free window)
//   'active'   -> a paid subscription is still valid (now < subscriptionExpiresAt)
//   'expired'  -> had a subscription/free window that has now lapsed
//   'required' -> never activated, must subscribe before further rides
export function getEffectiveSubscriptionStatus(driver, now = Date.now()) {
  const d = driver || {};
  const nowMs = toMillis(now) || now;

  // Free launch window (founder subscription-free window or the 60-day free window).
  const freeUntilMs = toMillis(d.subscriptionFreeUntil || d.founderFreeUntil);
  if (freeUntilMs > 0 && nowMs < freeUntilMs) {
    return { status: 'free', expiresAtMs: 0, freeUntilMs };
  }

  // Paid subscription window.
  const expiresAtMs = toMillis(d.subscriptionExpiresAt);
  if (expiresAtMs > 0) {
    return nowMs < expiresAtMs
      ? { status: 'active', expiresAtMs, freeUntilMs }
      : { status: 'expired', expiresAtMs, freeUntilMs };
  }

  // A free window existed and lapsed -> expired; otherwise never set -> required.
  if (freeUntilMs > 0) {
    return { status: 'expired', expiresAtMs: 0, freeUntilMs };
  }
  return { status: 'required', expiresAtMs: 0, freeUntilMs: 0 };
}

// True when the driver currently has valid subscription coverage (free or paid).
export function hasActiveSubscription(driver, now = Date.now()) {
  const s = getEffectiveSubscriptionStatus(driver, now);
  return s.status === 'free' || s.status === 'active';
}

// Computes the new expiration (epoch-ms) when a subscription is renewed.
//
// Business rule: newExpiration = max(now, currentSubscriptionExpiresAt) + 30 days.
// This never makes the driver lose remaining paid days when they renew early.
export function computeRenewedExpirationMs(driver, now = Date.now()) {
  const nowMs = toMillis(now) || now;
  const currentMs = toMillis(driver && driver.subscriptionExpiresAt);
  const base = Math.max(nowMs, currentMs);
  return base + SUBSCRIPTION_PERIOD_DAYS * DAY_MS;
}

// True when the driver holds founder status (tolerates both field names used
// across the codebase: mocks use isFounder, approveDriver writes founderEligible).
function isFounderDriver(driver) {
  const d = driver || {};
  return d.isFounder === true || d.founderEligible === true;
}

// SINGLE SOURCE OF TRUTH for the subscription/trial gate (governance D6).
// Independent from the commission-free period (which is decided separately by
// ridePricing.isCommissionFree). Answers: is an active subscription REQUIRED
// before this driver may receive/accept the next ride?
//
// Rules:
//   - Founder: covered while inside the free window (or with a paid subscription);
//     after it, a paid subscription is required. Founders do NOT use the 5-ride
//     grace, so freeRidesRemaining is always 0 for them.
//   - Non-founder: the first NON_FOUNDER_FREE_RIDES (5) finalized rides need no
//     subscription; from the 6th onward a free/active subscription is required.
//
// Returns { required, covered, reason, freeRidesRemaining, subscriptionStatus }.
export function getSubscriptionEligibility(driver, now = Date.now()) {
  const d = driver || {};
  const sub = getEffectiveSubscriptionStatus(d, now);
  const covered = sub.status === 'free' || sub.status === 'active';

  if (isFounderDriver(d)) {
    return {
      required: !covered,
      covered,
      reason: covered ? 'FOUNDER_COVERED' : 'FOUNDER_SUBSCRIPTION_REQUIRED',
      freeRidesRemaining: 0,
      subscriptionStatus: sub.status,
    };
  }

  const used = Number(d.freeRideCountUsed) || 0;
  const freeRidesRemaining = Math.max(0, NON_FOUNDER_FREE_RIDES - used);

  if (covered) {
    return {
      required: false,
      covered: true,
      reason: 'SUBSCRIPTION_ACTIVE',
      freeRidesRemaining,
      subscriptionStatus: sub.status,
    };
  }
  if (freeRidesRemaining > 0) {
    return {
      required: false,
      covered: false,
      reason: 'FREE_RIDES_REMAINING',
      freeRidesRemaining,
      subscriptionStatus: sub.status,
    };
  }
  return {
    required: true,
    covered: false,
    reason: 'SUBSCRIPTION_REQUIRED',
    freeRidesRemaining: 0,
    subscriptionStatus: sub.status,
  };
}
