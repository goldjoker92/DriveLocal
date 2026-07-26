// Pure presentation helpers for the targeted driver offer.
// The backend remains authoritative for eligibility, fare and final settlement.
// This module only presents the versioned commercial policy and never persists or
// authorizes a commission, subscription or wallet mutation.

import {
  BPS_DENOMINATOR,
  MIN_WALLET_BALANCE_CENTAVOS,
  getVehiclePricing,
} from '../constants/pricingConfig';
import { formatDateBR } from './driverCockpit';
import { getSubscriptionMonthlyCentavos } from './driverSubscription';
import { resolveCommercialPolicy } from './commercialPolicy';

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

  // Driver-facing copy is deliberately restricted to 0%, 12% or 15%:
  //   - 0% when the real commission is zero, including a minimum-net cap;
  //   - otherwise the standard vehicle policy rate.
  // Centavo adjustments never become custom percentages in the driver UI.
  const commissionPercentLabel = Number.isInteger(standardPercent)
    ? `${standardPercent}%`
    : `${standardPercent.toFixed(1).replace('.', ',')}%`;
  const displayedCommissionPercentLabel = commissionCentavos === 0
    ? '0%'
    : commissionPercentLabel;

  return {
    commissionCentavos,
    commissionPercentLabel: displayedCommissionPercentLabel,
    minimumGuaranteeApplied: commissionCentavos < rawCommission,
  };
}

export function deriveRideOfferPresentation(driver, offer, nowMs = Date.now()) {
  const vehicleType = offer?.vehicleType || driver?.vehicleType || 'car';
  const serviceAreaId = offer?.serviceAreaId || driver?.serviceAreaId;
  const policyDriver = { ...(driver || {}), vehicleType, serviceAreaId };
  const commercial = resolveCommercialPolicy(policyDriver, nowMs);
  const fareCentavos = Math.max(0, Math.round(Number(offer?.estimatedFareCentavos) || 0));
  const commission = calculateOfferCommission({
    fareCentavos,
    vehicleType,
    serviceAreaId,
    commissionFree: commercial.freePeriodActive,
  });
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
    commercialPolicyVersion: commercial.policyVersion,
    subscriptionCoverageSource: commercial.subscriptionCoverageSource,
    vehicleType,
    vehicleName: vehicleLabel(vehicleType),
    fareCentavos,
    pickupEtaMinutes: estimatePickupMinutes(offer?.distanceToPickupMeters, vehicleType),
    commissionFree: commercial.freePeriodActive,
    commissionFreeUntilLabel: formatDateBR(commercial.freePeriodUntilMs),
    commissionCentavos: commission.commissionCentavos,
    commissionPercentLabel: commission.commissionPercentLabel,
    minimumGuaranteeApplied: commission.minimumGuaranteeApplied,
    driverNetCentavos: Math.max(0, fareCentavos - commission.commissionCentavos),
    founder: commercial.founder,
    founderBenefitActive: commercial.founderFreeActive,
    founderBenefitUntilLabel: formatDateBR(commercial.founderSubscriptionUntilMs),
    planCentavos: getSubscriptionMonthlyCentavos(vehicleType),
    paidPlanActive: commercial.paidSubscriptionActive,
    subscriptionExpiresAtLabel: formatDateBR(commercial.subscriptionExpiresAtMs),
    freeRideCountUsed: commercial.freeRideCountUsed,
    freeRidesRemaining: commercial.freeRidesRemaining,
    subscriptionRequired: commercial.subscriptionRequired,
    walletBalanceCentavos,
    walletLow: commercial.walletTopupRequired
      && walletBalanceCentavos <= MIN_WALLET_BALANCE_CENTAVOS,
    acceptanceRate: acceptanceRatePercent(driver),
  };
}
