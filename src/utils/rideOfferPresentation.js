// Pure presentation helpers for the targeted driver offer.
// The backend remains authoritative for eligibility, fare and final settlement.
// This module only presents the versioned commercial policy and never persists or
// authorizes a commission or wallet mutation.

import {
  MIN_WALLET_BALANCE_CENTAVOS,
  getVehiclePricing,
} from '../constants/pricingConfig';
import { formatDateBR } from './driverCockpit';
import { resolveCommercialPolicy } from './commercialPolicy';

const PICKUP_AVERAGE_SPEED_KPH = Object.freeze({ moto: 25, car: 22 });
const SAFE_COMMISSION_DISPLAY_BPS = new Set([0, 1200, 1500]);

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

function normalizeCommissionDisplayBps({
  commissionDisplayBps,
  commissionFree,
  vehicleType,
  serviceAreaId,
}) {
  const supplied = Number(commissionDisplayBps);
  if (SAFE_COMMISSION_DISPLAY_BPS.has(supplied)) return supplied;
  if (commissionFree) return 0;

  const pricing = getVehiclePricing(serviceAreaId, vehicleType);
  const standardBps = Number(pricing?.normalCommissionBps || 0);
  return SAFE_COMMISSION_DISPLAY_BPS.has(standardBps) ? standardBps : 0;
}

// Despite the historical function name, this helper no longer calculates or
// returns an exact commission amount. The passenger pays the full fare directly
// to the driver by Pix; the wallet settlement is a separate server-only concern.
export function calculateOfferCommission({
  fareCentavos,
  vehicleType,
  serviceAreaId,
  commissionFree,
  commissionDisplayBps,
}) {
  const fare = Math.max(0, Math.round(Number(fareCentavos) || 0));
  const displayBps = normalizeCommissionDisplayBps({
    commissionDisplayBps,
    commissionFree,
    vehicleType,
    serviceAreaId,
  });
  const displayPercent = displayBps / 100;

  return {
    commissionDisplayBps: displayBps,
    commissionPercentLabel: `${displayPercent}%`,
    // A zero server-projected rate outside the free window means the backend
    // minimum-net cap removed the hold. No centavo amount is sent to the app.
    minimumGuaranteeApplied: displayBps === 0 && !commissionFree && fare > 0,
    driverReceivesCentavos: fare,
    // Compatibility alias for the current screen. It now means the full direct
    // Pix receipt, not fare minus a hidden wallet commission.
    driverNetCentavos: fare,
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
    commissionDisplayBps: offer?.commissionDisplayBps,
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
    vehicleType,
    vehicleName: vehicleLabel(vehicleType),
    fareCentavos,
    pickupEtaMinutes: estimatePickupMinutes(offer?.distanceToPickupMeters, vehicleType),
    commissionFree: commercial.freePeriodActive,
    commissionFreeUntilLabel: formatDateBR(commercial.freePeriodUntilMs),
    commissionDisplayBps: commission.commissionDisplayBps,
    commissionPercentLabel: commission.commissionPercentLabel,
    minimumGuaranteeApplied: commission.minimumGuaranteeApplied,
    driverReceivesCentavos: commission.driverReceivesCentavos,
    driverNetCentavos: commission.driverNetCentavos,
    founder: commercial.founder,
    walletBalanceCentavos,
    walletLow: commercial.walletTopupRequired
      && walletBalanceCentavos <= MIN_WALLET_BALANCE_CENTAVOS,
    acceptanceRate: acceptanceRatePercent(driver),
  };
}
