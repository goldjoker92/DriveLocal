// Approved-driver cockpit helpers (Iteration 2A).
//
// Pure functions over an already-loaded drivers/{uid} object, plus PT-BR copy.
// No Firestore access here — reads only. Business rule: the admin decision on
// drivers/{uid} is the source of truth; the driver app only interprets it.

import { passesSubscriptionOrTrial } from './driverEligibility';

const DAY_MS = 24 * 60 * 60 * 1000;

// Availability values written to drivers/{uid}.availabilityStatus. The backend
// dispatch query accepts only "online"; AVAILABLE is kept as a compatibility
// alias so older screen code cannot accidentally write the obsolete "available".
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

export function isFounderDriverDoc(driver) {
  return isFounderDriver(driver);
}

export function deriveEligibility(driver) {
  if (!driver) return { eligible: false, reasonCode: 'driver_missing' };
  if (driver.verificationStatus !== 'approved') {
    return { eligible: false, reasonCode: 'not_approved' };
  }
  if (driver.isBlocked === true || driver.isSuspended === true) {
    return { eligible: false, reasonCode: 'blocked' };
  }
  if (!passesSubscriptionOrTrial(driver)) {
    return { eligible: false, reasonCode: 'subscription_required' };
  }
  return { eligible: true, reasonCode: 'eligible' };
}

export function subscriptionDisplay(driver, nowMs) {
  const freeUntil = subscriptionFreeUntilMs(driver);
  if (freeUntil > nowMs) return { mode: 'free', dateMs: freeUntil };
  const expiresAt = toMillis(driver && driver.subscriptionExpiresAt);
  if (driver && driver.subscriptionActive === true && expiresAt > nowMs) {
    return { mode: 'active', dateMs: expiresAt };
  }
  return { mode: 'required', dateMs: expiresAt || null };
}

export function commissionDisplay(driver, nowMs) {
  const freeUntil = commissionFreeUntilMs(driver);
  if (freeUntil > nowMs) return { mode: 'free', dateMs: freeUntil };
  return { mode: 'standard', rateBps: Number(driver && driver.commissionRateBps) || 0 };
}

export function rideBlockReasonLabel(reasonCode) {
  const labels = {
    driver_missing: 'Cadastro de motorista não encontrado.',
    not_approved: 'Seu cadastro ainda não foi aprovado.',
    blocked: 'Sua conta está bloqueada ou suspensa.',
    subscription_required: 'Ative sua assinatura ou use suas corridas gratuitas disponíveis.',
    wallet_required: 'Recarregue seu Saldo DriveLocal para receber corridas.',
  };
  return labels[reasonCode] || 'Você não pode receber corridas no momento.';
}
