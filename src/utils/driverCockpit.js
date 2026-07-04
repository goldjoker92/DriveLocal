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

import { isFounderCommissionFreeActive } from '../services/founderService';

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
// Business rule (protects the #101+ subscription rule): being approved is NOT
// enough on its own. An approved driver may go available only when at least one
// POSITIVE signal is present:
//   - active founder benefit period (0% commission window), OR
//   - an active subscription (free window or flagged active), OR
//   - the admin explicitly set canReceiveRides === true.
//
// A missing canReceiveRides does NOT count as eligible. So an approved #101+
// driver with no active founder period, no active subscription, and no explicit
// allow is BLOCKED until they activate their subscription.
export function deriveEligibility(driver) {
  const d = driver || {};
  const nowMs = Date.now();

  // 1. Must be approved by the admin.
  if (d.verificationStatus !== 'approved') {
    return { eligible: false, reasonCode: d.verificationStatus || 'not_approved' };
  }

  // 2. Requires a positive signal — approved alone is never enough.
  const founderActive = isFounderCommissionFreeActive(d); // #001-#100 in 0% window
  const subscriptionActive = isSubscriptionActive(d, nowMs);
  const explicitlyAllowed = d.canReceiveRides === true; // admin override
  if (founderActive || subscriptionActive || explicitlyAllowed) {
    return { eligible: true, reasonCode: null };
  }

  // 3. Blocked. Prefer an explicit admin reason when one was set, otherwise
  //    default to "activate your subscription" (the #101+ case).
  const reasonCode =
    d.canReceiveRides === false && d.canReceiveRidesReason
      ? d.canReceiveRidesReason
      : 'subscription_required';
  return { eligible: false, reasonCode };
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
    return { mode: 'active', dateMs: 0 };
  }
  return { mode: 'required', dateMs: 0 };
}

// Commission display state for the dashboard.
//   'free'     -> founder 0% window (dateMs = when it ends)
//   'standard' -> standard 15% per completed ride
// Never reports "free"/0% without an expiry date (product rule).
export function commissionDisplay(driver, nowMs) {
  const freeMs = commissionFreeUntilMs(driver);
  if (isFounderCommissionFreeActive(driver) && freeMs && nowMs < freeMs) {
    return { mode: 'free', dateMs: freeMs };
  }
  return { mode: 'standard', dateMs: 0 };
}
