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

// The backend dispatch query accepts only "online". AVAILABLE remains a
// compatibility alias so existing UI code cannot write the obsolete value.
export const AVAILABILITY = {
  ONLINE: 'online',
  AVAILABLE: 'online',
  OFFLINE: 'offline',
};

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

export function formatDateBR(ms) {
  if (!ms) return null;
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function isFounderDriver(driver) {
  if (!driver) return false;
  return driver.founderBadgeActive === true || driver.founderEligible === true;
}

export function founderNumberLabel(driver) {
  const n = driver && (driver.founderNumber || driver.approvalNumber);
  if (!n) return null;
  return '#' + String(n).padStart(3, '0');
}

export function commissionFreeUntilMs(driver) {
  return toMillis(driver && (driver.commissionFreeUntil || driver.founderExpiresAt));
}

export function subscriptionFreeUntilMs(driver) {
  return toMillis(driver && driver.subscriptionFreeUntil);
}

export function daysUntil(targetMs, nowMs) {
  if (!targetMs) return null;
  return Math.ceil((targetMs - nowMs) / DAY_MS);
}

export function benefitWarning(label, targetMs, nowMs) {
  const days = daysUntil(targetMs, nowMs);
  if (days === null) return null;
  if (days < 0) return `${label} expirou.`;
  if (days === 0) return `${label} termina hoje.`;
  if (days === 1) return `${label} termina amanhã.`;
  if (days <= 7) return `${label} termina em ${days} dias.`;
  return null;
}

export const RIDE_BLOCK_REASON_LABELS = {
  subscription_required: 'Ative sua assinatura para receber corridas.',
  correction_required: 'Corrija seu cadastro para continuar.',
  correction_requested: 'Corrija seu cadastro para continuar.',
  rejected: 'Seu cadastro não foi aprovado.',
  suspended: 'Sua conta está temporariamente bloqueada.',
  blocked: 'Sua conta está temporariamente bloqueada.',
  wallet_low: 'Recarregue seu saldo para receber corridas.',
  wallet_required: 'Recarregue seu saldo para receber corridas.',
  not_approved: 'Seu cadastro ainda está em análise.',
  driver_missing: 'Cadastro de motorista não encontrado.',
};

export function rideBlockReasonLabel(code) {
  return RIDE_BLOCK_REASON_LABELS[code] || 'Você ainda não pode ficar disponível.';
}

export function isSubscriptionActive(driver, nowMs) {
  const s = subscriptionDisplay(driver, nowMs);
  return s.mode === 'free' || s.mode === 'active';
}

export function deriveEligibility(driver) {
  const d = driver || {};
  const nowMs = Date.now();

  if (d.verificationStatus !== 'approved') {
    return { eligible: false, reasonCode: d.verificationStatus || 'not_approved' };
  }

  if (d.isBlocked === true || d.verificationStatus === 'suspended' || d.isSuspended === true) {
    return { eligible: false, reasonCode: 'suspended' };
  }

  if (passesSubscriptionOrTrial(d, nowMs)) {
    return { eligible: true, reasonCode: null };
  }

  return { eligible: false, reasonCode: 'subscription_required' };
}

export function subscriptionDisplay(driver, nowMs) {
  const d = driver || {};
  const freeMs = subscriptionFreeUntilMs(d);
  if (freeMs && nowMs < freeMs) {
    return { mode: 'free', dateMs: freeMs };
  }
  if (d.subscriptionActive === true || d.subscriptionStatus === 'active') {
    return { mode: 'active', dateMs: toMillis(d.subscriptionExpiresAt) };
  }
  return { mode: 'required', dateMs: 0 };
}

export function commissionDisplay(driver, nowMs) {
  const freeMs = commissionFreeUntilMs(driver);
  if (freeMs && nowMs < freeMs) {
    return { mode: 'free', dateMs: freeMs };
  }
  return { mode: 'standard', dateMs: 0 };
}
