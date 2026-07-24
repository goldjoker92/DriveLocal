// Pure presentation helpers for the targeted driver offer.
// The backend remains authoritative for eligibility, fare and final settlement.

import {
  BPS_DENOMINATOR,
  MIN_WALLET_BALANCE_CENTAVOS,
  getVehiclePricing,
} from '../constants/pricingConfig';
import {
  commissionFreeUntilMs,
  formatDateBR,
  isFounderDriver,
} from './driverCockpit';
import {
  getSubscriptionEligibility,
  getSubscriptionMonthlyCentavos,
  toMillis,
} from './driverSubscription';

const PICKUP_AVERAGE_SPEED_KPH = Object.freeze({ moto: 25, car: 22 });

export function vehicleLabel(vehicleType) {
  return vehicleType === 'moto' ? 'Moto' : 'Carro';
}

export function estimatePickupMinutes(distanceMeters, vehicleType) {
  const distance = Math.max(0, Number(distanceMeters) || 0);
  if (distance <= 100) return 0;
  const speedKph = PICKUP_AVERAGE_SPEED_KPH[vehicleType] || PICKUP_AVERAGE_SPEED_KPH.car;
  return Math.max(1, Math.ceil((distance / 1000 / speedKph) * 60));
}

export function formatPickupEta(minutes) {
  return minutes <= 0 ? 'Agora' : `${minutes} min`;
}

export function acceptanceRatePercent(driver) {
  const d = driver || {};
  const direct = Number(
    d.acceptanceRatePercent
    ?? d.acceptanceRatePct
    ?? d.rideAcceptanceRate
    ?? d.acceptanceRate
  );

  if (Number.isFinite(direct) && direct >= 0) {
    return Math.min(100, Math.round(direct <= 1 ? direct * 100 : direct));
  }

  const received = Number(d.offerCountReceived ?? d.totalOffersReceived ?? d.receivedOfferCount);
  const accepted = Number(d.offerCountAccepted ?? d.totalOffersAccepted ?? d.acceptedOfferCount);
  if (Number.isFinite(received) && received > 0 && Number.isFinite(accepted) && accepted >= 0) {
    return Math.min(100, Math.round((accepted / received) * 100));
  }

  return null;
}

export function calculateOfferCommission({
  fareCentavos,
  vehicleType,
  serviceAreaId,
  commissionFree,
}) {
  const fare = Math.max(0, Math.round(Number(fareCentavos) || 0));
  const pricing = getVehiclePricing(serviceAreaId, vehicleType);
  const standardBps = Number(pricing?.normalCommissionBps || 0);
  const standardPercent = standardBps / 100;

  if (commissionFree || fare === 0 || standardBps <= 0) {
    return {
      commissionCentavos: 0,
      commissionPercentLabel: '0%',
      minimumGuaranteeApplied: false,
    };
  }

  const rawCommission = Math.round((fare * standardBps) / BPS_DENOMINATOR);
  const minimumNet = Math.max(0, Number(pricing?.minimumDriverNetCentavos || 0));
  const cap = Math.max(0, fare - minimumNet);
  const commissionCentavos = Math.max(0, Math.min(rawCommission, cap));
  const effectivePercent = fare > 0 ? (commissionCentavos / fare) * 100 : standardPercent;
  const shownPercent = Math.abs(effectivePercent - standardPercent) < 0.6
    ? standardPercent
    : effectivePercent;
  const commissionPercentLabel = Number.isInteger(shownPercent)
    ? `${shownPercent}%`
    : `${shownPercent.toFixed(1).replace('.', ',')}%`;

  return {
    commissionCentavos,
    commissionPercentLabel,
    minimumGuaranteeApplied: commissionCentavos < rawCommission,
  };
}

export function deriveRideOfferPresentation(driver, offer, nowMs = Date.now()) {
  const vehicleType = offer?.vehicleType || driver?.vehicleType || 'car';
  const fareCentavos = Math.max(0, Math.round(Number(offer?.estimatedFareCentavos) || 0));
  const commissionEndMs = commissionFreeUntilMs(driver);
  const commissionFree = commissionEndMs > nowMs;
  const commission = calculateOfferCommission({
    fareCentavos,
    vehicleType,
    serviceAreaId: offer?.serviceAreaId,
    commissionFree,
  });
  const subscription = getSubscriptionEligibility(driver, nowMs);
  const founder = isFounderDriver(driver);
  const founderSubscriptionEndMs = toMillis(driver?.subscriptionFreeUntil || driver?.founderFreeUntil);
  const subscriptionExpiresAtMs = toMillis(driver?.subscriptionExpiresAt);
  const walletBalanceCentavos = Math.max(
    0,
    Number(
      driver?.walletAvailableCentavos
      ?? driver?.walletBalanceCentavos
      ?? driver?.balanceCents
      ?? 0
    ) || 0
  );

  return {
    vehicleType,
    vehicleName: vehicleLabel(vehicleType),
    fareCentavos,
    pickupEtaMinutes: estimatePickupMinutes(offer?.distanceToPickupMeters, vehicleType),
    commissionFree,
    commissionFreeUntilLabel: formatDateBR(commissionEndMs),
    commissionCentavos: commission.commissionCentavos,
    commissionPercentLabel: commission.commissionPercentLabel,
    minimumGuaranteeApplied: commission.minimumGuaranteeApplied,
    driverNetCentavos: Math.max(0, fareCentavos - commission.commissionCentavos),
    founder,
    founderBenefitActive: founder && founderSubscriptionEndMs > nowMs,
    founderBenefitUntilLabel: formatDateBR(
      Math.min(commissionEndMs || founderSubscriptionEndMs, founderSubscriptionEndMs)
    ),
    planCentavos: getSubscriptionMonthlyCentavos(vehicleType),
    paidPlanActive: subscription.subscriptionStatus === 'active',
    subscriptionExpiresAtLabel: formatDateBR(subscriptionExpiresAtMs),
    freeRidesRemaining: subscription.freeRidesRemaining,
    subscriptionRequired: subscription.required,
    walletBalanceCentavos,
    walletLow: !commissionFree && walletBalanceCentavos <= MIN_WALLET_BALANCE_CENTAVOS,
    acceptanceRate: acceptanceRatePercent(driver),
  };
}
