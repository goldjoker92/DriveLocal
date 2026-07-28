// Driver subscription helpers (DriveLocal V1).
//
// Pure functions over an already-loaded drivers/{uid} object. No Firestore here.
// The backend remains authoritative; this module only keeps every mobile screen
// aligned with the same commercial-policy projection.

import {
  NON_FOUNDER_FREE_RIDES,
  SUBSCRIPTION_MONTHLY_CENTAVOS,
  SUBSCRIPTION_PERIOD_DAYS,
  getVehiclePricing,
} from '../constants/pricingConfig';
import { WALLET_FALLBACK_LOW_THRESHOLD_CENTS } from '../constants/walletRules';
import {
  DAY_MS,
  SUBSCRIPTION_COVERAGE_SOURCE,
  approvalTimeMs,
  founderSubscriptionUntilMs,
  resolveCommercialPolicy,
  toMillis as policyToMillis,
} from './commercialPolicy';
import { formatBRL } from './format';
import { formatDateBR } from './driverCockpit';

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
//   - consuming the five rides never ends the 0% commission window;
//   - after day 60: paid subscription, standard commission and wallet apply to all;
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

export const DRIVER_SUBSCRIPTION_VIEW_VERSION = 'driver-subscription-view-v2';

export const DRIVER_SUBSCRIPTION_MODE = Object.freeze({
  FOUNDER_FREE: 'founder_free',
  RIDE_GRACE: 'ride_grace',
  ACTIVE: 'active',
  REQUIRED_COMMISSION_FREE: 'required_commission_free',
  REQUIRED_STANDARD: 'required_standard',
  UNAVAILABLE: 'unavailable',
});

const VEHICLES = Object.freeze([
  { type: 'moto', label: 'Moto', emoji: '🏍' },
  { type: 'car', label: 'Carro', emoji: '🚗' },
]);

function futureTimestamp(value, nowMs) {
  const number = Number(value);
  return Number.isFinite(number) && number > nowMs ? number : null;
}

function firstFutureTimestamp(values, nowMs) {
  const valid = values
    .map((value) => futureTimestamp(value, nowMs))
    .filter((value) => value != null);
  return valid.length > 0 ? Math.min(...valid) : null;
}

function dateLabel(timestampMs) {
  return timestampMs ? formatDateBR(timestampMs) : null;
}

function safePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function rule(key, label, value, detail) {
  return Object.freeze({ key, label, value, detail });
}

function section(key, title, items) {
  return Object.freeze({ key, title, items: Object.freeze(items) });
}

function recurringPlanLabel(currentPlan) {
  return currentPlan
    ? `${currentPlan.priceLabel} a cada ${currentPlan.periodDays} dias`
    : 'Plano indisponível';
}

function standardCommissionLabel(currentPlan) {
  return currentPlan ? `${currentPlan.commissionLabel} por corrida` : 'Taxa indisponível';
}

function buildRuleSections({
  policy,
  currentPlan,
  used,
  freePeriodDate,
  founderDate,
  subscriptionDate,
}) {
  const recurringPlan = recurringPlanLabel(currentPlan);
  const standardCommission = standardCommissionLabel(currentPlan);
  const walletThreshold = formatBRL(WALLET_FALLBACK_LOW_THRESHOLD_CENTS);
  const commissionFreeDetail = freePeriodDate
    ? `Garantida até ${freePeriodDate}, mesmo quando a assinatura já for paga.`
    : 'Válida durante o período promocional confirmado no cadastro.';
  const noWalletDetail = freePeriodDate
    ? `Nenhuma recarga é necessária até ${freePeriodDate}, enquanto a comissão for 0%.`
    : 'Nenhuma recarga é necessária enquanto a comissão for 0%.';
  const walletRequiredDetail = `Mantenha o saldo disponível acima de ${walletThreshold} para receber novas corridas.`;
  const monthlyRequiredDetail = currentPlan
    ? `${recurringPlan}. O plano precisa estar ativo para receber novas corridas.`
    : 'Complete o tipo de veículo para consultar e ativar o plano.';
  const afterLaunchTitle = freePeriodDate
    ? `A partir de ${freePeriodDate}`
    : 'Depois do período promocional';

  if (policy.founderFreeActive) {
    return Object.freeze([
      section('now', 'Agora — benefício de fundador', [
        rule(
          'subscription',
          'Assinatura',
          'Grátis',
          founderDate ? `Sem pagamento até ${founderDate}.` : 'Gratuita durante o período fundador.'
        ),
        rule('commission', 'Comissão', '0%', commissionFreeDetail),
        rule('wallet', 'Saldo DriveLocal', 'Sem recarga', noWalletDetail),
      ]),
      section('after_launch', 'Depois dos 60 dias', [
        rule('subscription', 'Assinatura', 'Mensal obrigatória', monthlyRequiredDetail),
        rule('commission', 'Comissão', standardCommission, 'Aplicada em cada corrida concluída.'),
        rule('wallet', 'Saldo DriveLocal', 'Obrigatório', walletRequiredDetail),
      ]),
    ]);
  }

  if (policy.nonFounderGraceActive) {
    const remaining = Math.max(0, NON_FOUNDER_FREE_RIDES - used);
    const rideWord = remaining === 1 ? 'corrida promocional restante' : 'corridas promocionais restantes';
    return Object.freeze([
      section('now', `Agora — ${used} de ${NON_FOUNDER_FREE_RIDES} corridas usadas`, [
        rule(
          'subscription',
          'Assinatura',
          'Sem pagamento',
          `${remaining} ${rideWord}. O plano passa a ser obrigatório depois da 5ª corrida ou no fim dos 60 dias, o que ocorrer primeiro.`
        ),
        rule('commission', 'Comissão', '0%', commissionFreeDetail),
        rule('wallet', 'Saldo DriveLocal', 'Sem recarga', noWalletDetail),
      ]),
      section('after_fifth_ride', 'Depois da 5ª corrida', [
        rule('subscription', 'Assinatura', 'Mensal obrigatória', monthlyRequiredDetail),
        rule(
          'commission',
          'Comissão',
          'Continua 0%',
          freePeriodDate ? `Permanece em 0% até ${freePeriodDate}.` : commissionFreeDetail
        ),
        rule('wallet', 'Saldo DriveLocal', 'Ainda sem recarga', noWalletDetail),
      ]),
      section('after_launch', afterLaunchTitle, [
        rule('subscription', 'Assinatura', 'Continua mensal', monthlyRequiredDetail),
        rule('commission', 'Comissão', standardCommission, 'Aplicada em cada corrida concluída.'),
        rule('wallet', 'Saldo DriveLocal', 'Obrigatório', walletRequiredDetail),
      ]),
    ]);
  }

  if (policy.paidSubscriptionActive) {
    const nowItems = [
      rule(
        'subscription',
        'Assinatura',
        'Ativa',
        subscriptionDate
          ? `Ativa até ${subscriptionDate}. A renovação acrescenta 30 dias à expiração atual.`
          : 'Ativa. Cada renovação acrescenta 30 dias à expiração atual.'
      ),
      rule(
        'commission',
        'Comissão',
        policy.freePeriodActive ? '0%' : standardCommission,
        policy.freePeriodActive ? commissionFreeDetail : 'Aplicada em cada corrida concluída.'
      ),
      rule(
        'wallet',
        'Saldo DriveLocal',
        policy.freePeriodActive ? 'Sem recarga' : 'Obrigatório',
        policy.freePeriodActive ? noWalletDetail : walletRequiredDetail
      ),
    ];

    const sections = [section('now', 'Agora', nowItems)];
    if (policy.freePeriodActive) {
      sections.push(section('after_launch', afterLaunchTitle, [
        rule('subscription', 'Assinatura', 'Continua mensal', monthlyRequiredDetail),
        rule('commission', 'Comissão', standardCommission, 'Aplicada em cada corrida concluída.'),
        rule('wallet', 'Saldo DriveLocal', 'Obrigatório', walletRequiredDetail),
      ]));
    } else if (subscriptionDate) {
      sections.push(section('renewal', `Antes de ${subscriptionDate}`, [
        rule(
          'renewal',
          'Renovação',
          recurringPlan,
          'Renove para continuar recebendo corridas. Os dias restantes são preservados.'
        ),
      ]));
    }
    return Object.freeze(sections);
  }

  if (policy.freePeriodActive) {
    return Object.freeze([
      section('now', 'Agora — 5 corridas promocionais concluídas', [
        rule('subscription', 'Assinatura', 'Mensal obrigatória', monthlyRequiredDetail),
        rule('commission', 'Comissão', '0%', commissionFreeDetail),
        rule('wallet', 'Saldo DriveLocal', 'Sem recarga', noWalletDetail),
      ]),
      section('after_launch', afterLaunchTitle, [
        rule('subscription', 'Assinatura', 'Continua mensal', monthlyRequiredDetail),
        rule('commission', 'Comissão', standardCommission, 'Aplicada em cada corrida concluída.'),
        rule('wallet', 'Saldo DriveLocal', 'Obrigatório', walletRequiredDetail),
      ]),
    ]);
  }

  return Object.freeze([
    section('now', 'Agora — período promocional encerrado', [
      rule('subscription', 'Assinatura', 'Mensal obrigatória', monthlyRequiredDetail),
      rule('commission', 'Comissão', standardCommission, 'Aplicada em cada corrida concluída.'),
      rule('wallet', 'Saldo DriveLocal', 'Obrigatório', walletRequiredDetail),
    ]),
  ]);
}

export function driverSubscriptionPlan(vehicleType, serviceAreaId) {
  if (vehicleType !== 'moto' && vehicleType !== 'car') return null;
  const pricing = getVehiclePricing(serviceAreaId, vehicleType);
  const priceCentavos = Number(SUBSCRIPTION_MONTHLY_CENTAVOS[vehicleType]);
  const commissionBps = Number(pricing?.normalCommissionBps);
  if (!Number.isInteger(priceCentavos) || priceCentavos <= 0) return null;
  if (!Number.isInteger(commissionBps) || commissionBps < 0) return null;

  const vehicle = VEHICLES.find((item) => item.type === vehicleType);
  return Object.freeze({
    vehicleType,
    vehicleLabel: vehicle.label,
    vehicleEmoji: vehicle.emoji,
    priceCentavos,
    priceLabel: formatBRL(priceCentavos),
    periodDays: SUBSCRIPTION_PERIOD_DAYS,
    periodLabel: `${SUBSCRIPTION_PERIOD_DAYS} dias`,
    commissionBps,
    commissionPercent: commissionBps / 100,
    commissionLabel: `${commissionBps / 100}%`,
  });
}

export function driverSubscriptionCatalog(serviceAreaId) {
  return VEHICLES
    .map((vehicle) => driverSubscriptionPlan(vehicle.type, serviceAreaId))
    .filter(Boolean);
}

// Decision model for the real Pix subscription screen. The app only explains the
// current server-owned driver fields; createDriverPixPayment recalculates price and
// eligibility again before creating a Mercado Pago order.
export function deriveDriverSubscriptionView(driver, nowValue = Date.now()) {
  const d = driver || {};
  const nowMs = toMillis(nowValue) || Number(nowValue) || Date.now();
  const policy = resolveCommercialPolicy(d, nowMs);
  const currentPlan = driverSubscriptionPlan(policy.vehicleType, d.serviceAreaId);
  const catalog = driverSubscriptionCatalog(d.serviceAreaId);
  const approvalDate = dateLabel(approvalTimeMs(d));
  const freePeriodDate = dateLabel(policy.freePeriodUntilMs);
  const founderDate = dateLabel(policy.founderSubscriptionUntilMs);
  const subscriptionDate = dateLabel(policy.subscriptionExpiresAtMs);
  const used = Math.min(
    NON_FOUNDER_FREE_RIDES,
    Math.max(0, Number(policy.freeRideCountUsed || 0))
  );

  let mode = DRIVER_SUBSCRIPTION_MODE.UNAVAILABLE;
  let statusTitle = 'Plano indisponível';
  let statusDetail = 'Complete o tipo de veículo para consultar e pagar sua assinatura.';
  let paymentEnabled = false;
  let paymentButtonTitle = 'PAGAR COM PIX';
  let paymentReason = 'vehicle_unknown';
  let progressLabel = null;
  let renewalDetail = null;

  if (policy.founderFreeActive) {
    mode = DRIVER_SUBSCRIPTION_MODE.FOUNDER_FREE;
    statusTitle = 'Assinatura grátis';
    statusDetail = founderDate
      ? `Assinatura grátis até ${founderDate}.`
      : 'Sua assinatura gratuita está ativa.';
    paymentButtonTitle = '🔒 Pagar assinatura';
    paymentReason = 'founder_free_window';
  } else if (policy.nonFounderGraceActive) {
    mode = DRIVER_SUBSCRIPTION_MODE.RIDE_GRACE;
    statusTitle = 'Corridas sem assinatura';
    progressLabel = `${used} de ${NON_FOUNDER_FREE_RIDES} corridas sem assinatura utilizadas`;
    statusDetail = progressLabel;
    paymentButtonTitle = '🔒 Pagar assinatura';
    paymentReason = 'ride_grace_active';
  } else if (policy.paidSubscriptionActive) {
    mode = DRIVER_SUBSCRIPTION_MODE.ACTIVE;
    statusTitle = 'Assinatura ativa';
    statusDetail = subscriptionDate
      ? `Ativa até ${subscriptionDate}.`
      : 'Sua assinatura está ativa.';
    paymentEnabled = Boolean(currentPlan);
    paymentButtonTitle = 'RENOVAR COM PIX';
    paymentReason = currentPlan ? null : 'vehicle_unknown';
    renewalDetail = 'A renovação adiciona 30 dias à expiração atual. Seus dias restantes são preservados.';
  } else if (policy.freePeriodActive) {
    mode = DRIVER_SUBSCRIPTION_MODE.REQUIRED_COMMISSION_FREE;
    statusTitle = 'Assinatura necessária';
    statusDetail = freePeriodDate
      ? `Comissão 0% até ${freePeriodDate}.`
      : 'Sua comissão promocional continua em 0%.';
    paymentEnabled = Boolean(currentPlan);
    paymentButtonTitle = 'PAGAR COM PIX';
    paymentReason = currentPlan ? null : 'vehicle_unknown';
  } else {
    mode = DRIVER_SUBSCRIPTION_MODE.REQUIRED_STANDARD;
    statusTitle = 'Assinatura necessária';
    statusDetail = currentPlan
      ? `Comissão ${currentPlan.commissionLabel} após a ativação.`
      : 'Selecione um veículo válido para consultar o plano.';
    paymentEnabled = Boolean(currentPlan);
    paymentButtonTitle = 'PAGAR COM PIX';
    paymentReason = currentPlan ? null : 'vehicle_unknown';
  }

  const commissionLabel = policy.freePeriodActive
    ? '0%'
    : currentPlan?.commissionLabel || null;
  const commissionDetail = policy.freePeriodActive
    ? freePeriodDate
      ? `Comissão 0% até ${freePeriodDate}`
      : 'Comissão promocional 0%'
    : currentPlan
      ? `Comissão ${currentPlan.commissionLabel}`
      : 'Comissão indisponível';
  const approvalNumber = safePositiveInteger(d.approvalNumber || d.founderNumber);
  const profileTitle = policy.founder
    ? 'Motorista Fundador nº 1–100'
    : 'Motorista nº 101+';
  const profileDetail = [
    approvalNumber ? `Aprovação #${String(approvalNumber).padStart(3, '0')}` : null,
    approvalDate ? `em ${approvalDate}` : null,
  ].filter(Boolean).join(' ') || 'Condição calculada pelo cadastro aprovado.';
  const noSurpriseText = policy.founder
    ? 'Durante 60 dias, assinatura e comissão são gratuitas. Depois, assinatura mensal, comissão normal e saldo DriveLocal passam a ser obrigatórios.'
    : 'As 5 corridas definem quando a assinatura começa. Os 60 dias definem quando a comissão normal e o saldo DriveLocal começam. São contadores independentes.';
  const ruleSections = buildRuleSections({
    policy,
    currentPlan,
    used,
    freePeriodDate,
    founderDate,
    subscriptionDate,
  });

  return Object.freeze({
    version: DRIVER_SUBSCRIPTION_VIEW_VERSION,
    mode,
    currentPlan,
    catalog,
    statusTitle,
    statusDetail,
    progressLabel,
    paymentEnabled,
    paymentButtonTitle,
    paymentReason,
    renewalDetail,
    profileTitle,
    profileDetail,
    noSurpriseText,
    ruleSections,
    founder: policy.founder,
    freeRideCountUsed: used,
    freeRideLimit: NON_FOUNDER_FREE_RIDES,
    freeRidesRemaining: policy.freeRidesRemaining,
    commissionLabel,
    commissionDetail,
    approvalDate,
    freePeriodUntilMs: policy.freePeriodUntilMs || null,
    subscriptionExpiresAtMs: policy.subscriptionExpiresAtMs || null,
    transitionAtMs: firstFutureTimestamp([
      policy.founderSubscriptionUntilMs,
      policy.freePeriodUntilMs,
      policy.subscriptionExpiresAtMs,
    ], nowMs),
    paidSubscriptionActive: policy.paidSubscriptionActive,
    policyVersion: policy.policyVersion,
  });
}
