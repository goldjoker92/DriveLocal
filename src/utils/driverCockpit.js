// Approved-driver cockpit helpers (Iteration 2A).
//
// Pure functions over an already-loaded drivers/{uid} object, plus PT-BR copy.
// No Firestore access here — reads only. Business rule: the admin decision on
// drivers/{uid} is the source of truth; the driver app only interprets it.
//
// Field tolerance: the admin/approval flow has evolved, so the same concept can
// live under more than one field name. These helpers accept both the current
// fields written by approveDriver (founderEligible, founderExpiresAt,
// approvalNumber) and the friendlier names used elsewhere (founderBadgeActive,
// commissionFreeUntil, founderNumber). Missing fields never crash the UI.

import { passesSubscriptionOrTrial } from './driverEligibility';

const DAY_MS = 24 * 60 * 60 * 1000;

// Availability values written to drivers/{uid}.availabilityStatus.
export const AVAILABILITY = {
  AVAILABLE: 'available',
  OFFLINE: 'offline',
};

// Normalizes a Firestore Timestamp / Date / epoch-ms to epoch-ms (0 if absent).
export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

// Formats an epoch-ms as DD/MM/AAAA, or null when there is no date.
export function formatDateBR(ms) {
  if (!ms) return null;
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

// True when the driver is a founder (tolerates both field names).
export function isFounderDriver(driver) {
  if (!driver) return false;
  return driver.founderBadgeActive === true || driver.founderEligible === true;
}

// Founder display number, e.g. "#001". Prefers founderNumber, falls back to the
// sequential approvalNumber. Returns null when neither is present.
export function founderNumberLabel(driver) {
  const n = driver && (driver.founderNumber || driver.approvalNumber);
  if (!n) return null;
  return '#' + String(n).padStart(3, '0');
}

// Commission-free expiry (founder window). Tolerates both field names.
export function commissionFreeUntilMs(driver) {
  return toMillis(driver && (driver.commissionFreeUntil || driver.founderExpiresAt));
}

// Subscription-free expiry.
export function subscriptionFreeUntilMs(driver) {
  return toMillis(driver && driver.subscriptionFreeUntil);
}

// Whole days from nowMs to a target ms, rounded up. Null when no target.
// Negative result means the benefit has already expired.
export function daysUntil(targetMs, nowMs) {
  if (!targetMs) return null;
  return Math.ceil((targetMs - nowMs) / DAY_MS);
}

// Builds a PT-BR benefit expiry message, or null when there is nothing worth
// warning about yet. Only speaks up at 7 / 3 / 1 / same-day, or once expired.
export function benefitWarning(label, targetMs, nowMs) {
  const days = daysUntil(targetMs, nowMs);
  if (days === null) return null;
  if (days < 0) return `${label} expirou.`;
  if (days === 0) return `${label} termina hoje.`;
  if (days === 1) return `${label} termina amanhã.`;
  if (days <= 7) return `${label} termina em ${days} dias.`;
  return null;
}

// PT-BR explanation for each canReceiveRidesReason code (admin/derived).
export const RIDE_BLOCK_REASON_LABELS = {
  subscription_required: 'Ative sua assinatura para receber corridas.',
  correction_required: 'Corrija seu cadastro para continuar.',
  correction_requested: 'Corrija seu cadastro para continuar.',
  rejected: 'Seu cadastro não foi aprovado.',
  suspended: 'Sua conta está temporariamente bloqueada.',
  wallet_low: 'Recarregue seu saldo para receber corridas.',
  not_approved: 'Seu cadastro ainda está em análise.',
};

// Maps a reason code to a friendly PT-BR line, with a safe generic fallback.
export function rideBlockReasonLabel(code) {
  return RIDE_BLOCK_REASON_LABELS[code] || 'Você ainda não pode ficar disponível.';
}

// True when the driver currently has active subscription coverage: either
// inside a free-subscription window or a flagged active subscription.
export function isSubscriptionActive(driver, nowMs) {
  const s = subscriptionDisplay(driver, nowMs);
  return s.mode === 'free' || s.mode === 'active';
}

// Derives whether an approved driver may currently go available.
//
// Business rule: effective ride eligibility is computed with
// canDriverReceiveRide() (via the shared passesSubscriptionOrTrial gate);
// the stored canReceiveRides field is legacy/cache and must NOT be the final
// gate. It is kept only for admin display and never used to block here.
//
// A driver may go available when they are approved, not blocked, and pass the
// subscription/trial gate:
//   - founder inside the free window, OR
//   - a driver with an active/free subscription, OR
//   - a non-founder still within their first free rides (#101+ launch rule).
//
// The per-ride checks (vehicle-type match and the wallet/commission check) are
// applied later, at ride-accept time, by canDriverReceiveRide — they need the
// specific ride request and must not block the availability toggle here.
export function deriveEligibility(driver) {
  const d = driver || {};
  const nowMs = Date.now();

  // 1. Must be approved by the admin.
  if (d.verificationStatus !== 'approved') {
    return { eligible: false, reasonCode: d.verificationStatus || 'not_approved' };
  }

  // 2. Must not be blocked/suspended.
  if (d.isBlocked === true || d.verificationStatus === 'suspended') {
    console.log('[DriverEligibility] cockpit blocked reason=suspended');
    return { eligible: false, reasonCode: 'suspended' };
  }

  // 3. Subscription / trial gate (single source of truth, shared with dispatch).
  if (passesSubscriptionOrTrial(d, nowMs)) {
    return { eligible: true, reasonCode: null };
  }

  console.log('[DriverEligibility] cockpit blocked reason=subscription_required');
  return { eligible: false, reasonCode: 'subscription_required' };
}

// Subscription display state for the dashboard.
//   'free'     -> inside the free window (dateMs = when it ends)
//   'active'   -> paying / active subscription
//   'required' -> must activate before receiving rides
export function subscriptionDisplay(driver, nowMs) {
  const d = driver || {};
  const freeMs = subscriptionFreeUntilMs(d);
  if (freeMs && nowMs < freeMs) {
    return { mode: 'free', dateMs: freeMs };
  }
  if (d.subscriptionActive === true || d.subscriptionStatus === 'active') {
    // dateMs = when the active subscription expires (0 when not set).
    return { mode: 'active', dateMs: toMillis(d.subscriptionExpiresAt) };
  }
  return { mode: 'required', dateMs: 0 };
}

// Commission display state for the dashboard.
//   'free'     -> 0% commission window (dateMs = when it ends)
//   'standard' -> standard 15% per completed ride
// The 0% window covers both the founder period (founderExpiresAt) and the
// non-founder post-subscription promo (commissionFreeUntil set on activation).
// Never reports "free"/0% without a future expiry date (product rule).
export function commissionDisplay(driver, nowMs) {
  const freeMs = commissionFreeUntilMs(driver);
  if (freeMs && nowMs < freeMs) {
    return { mode: 'free', dateMs: freeMs };
  }
  return { mode: 'standard', dateMs: 0 };
}
