// Approved-driver cockpit helpers.
//
// Pure functions over an already-loaded drivers/{uid} object, plus PT-BR copy.
// No Firestore access here: the backend remains authoritative and the cockpit only
// presents the centralized commercial policy.

import {
  DAY_MS,
  freePeriodUntilMs,
  isFounderDriver as policyIsFounderDriver,
  resolveCommercialPolicy,
  toMillis as policyToMillis,
} from './commercialPolicy';

// The backend dispatch query accepts only "online". AVAILABLE remains a
// compatibility alias so existing UI code cannot write the obsolete value.
export const AVAILABILITY = {
  ONLINE: 'online',
  AVAILABLE: 'online',
  OFFLINE: 'offline',
};

export function toMillis(value) {
  return policyToMillis(value);
}

export function formatDateBR(ms) {
  if (!ms) return null;
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function isFounderDriver(driver) {
  return policyIsFounderDriver(driver);
}

export function founderNumberLabel(driver) {
  const n = driver && (driver.founderNumber || driver.approvalNumber);
  if (!n) return null;
  return '#' + String(n).padStart(3, '0');
}

export function commissionFreeUntilMs(driver) {
  return freePeriodUntilMs(driver);
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

export function deriveEligibility(driver) {
  const d = driver || {};

  if (d.verificationStatus !== 'approved') {
    return { eligible: false, reasonCode: d.verificationStatus || 'not_approved' };
  }

  if (d.isBlocked === true || d.verificationStatus === 'suspended' || d.isSuspended === true) {
    return { eligible: false, reasonCode: 'suspended' };
  }

  return { eligible: true, reasonCode: null };
}

export function commissionDisplay(driver, nowMs = Date.now()) {
  const policy = resolveCommercialPolicy(driver, nowMs);
  return {
    mode: policy.freePeriodActive ? 'free' : 'standard',
    dateMs: policy.freePeriodActive ? policy.freePeriodUntilMs : 0,
    percent: policy.commissionPercent,
    label: `${policy.commissionPercent}%`,
    bps: policy.commissionBps,
    policyVersion: policy.policyVersion,
  };
}
