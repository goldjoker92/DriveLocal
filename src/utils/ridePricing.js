// @ts-check
// DriveLocal V1.3 ride-pricing domain.
// Pure deterministic functions; all money is integer centavos.

import {
  getVehiclePricing,
  BPS_DENOMINATOR,
  DYNAMIC_PRICING_MAX_MULTIPLIER,
  PRICING_CONFIG_VERSION,
  DEFAULT_SERVICE_AREA_ID,
} from '../constants/pricingConfig';

export function roundCentavos(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

export function calculateBaseRideFare(vehiclePricing, distanceKm, durationMin) {
  if (!vehiclePricing) return 0;
  const km = Number(distanceKm);
  const min = Number(durationMin);
  const safeKm = km >= 0 ? km : 0;
  const safeMin = min >= 0 ? min : 0;
  return roundCentavos(
    vehiclePricing.baseFareCentavos
      + vehiclePricing.perKmCentavos * safeKm
      + vehiclePricing.perMinuteCentavos * safeMin
  );
}

export function applyFareMinimum(fareCentavos, minimumPassengerFareCentavos) {
  const fare = roundCentavos(fareCentavos);
  const minimum = roundCentavos(minimumPassengerFareCentavos);
  return fare < minimum ? minimum : fare;
}

export function isCommissionFree(driver, now = Date.now()) {
  const profile = driver || {};
  const nowMs = toMillis(now) || now;
  const untilMs = toMillis(profile.commissionFreeUntil || profile.founderExpiresAt);
  return untilMs > 0 && nowMs < untilMs;
}

export function calculateCommissionBps(
  vehicleType,
  distanceKm,
  driver,
  now = Date.now(),
  serviceAreaId = DEFAULT_SERVICE_AREA_ID
) {
  void distanceKm; // preserved for backward-compatible callers; distance no longer changes the rate.
  if (isCommissionFree(driver, now)) return 0;
  const vehiclePricing = getVehiclePricing(serviceAreaId, vehicleType);
  return vehiclePricing ? vehiclePricing.normalCommissionBps : 0;
}

export function calculatePlatformFeeCentavos(fareCentavos, commissionBps) {
  const fare = roundCentavos(fareCentavos);
  const bps = Number(commissionBps) || 0;
  const fee = roundCentavos((fare * bps) / BPS_DENOMINATOR);
  return fee < 0 ? 0 : fee;
}

export function calculateCommissionCap(passengerFareCentavos, minimumDriverNetCentavos) {
  const cap = roundCentavos(passengerFareCentavos) - roundCentavos(minimumDriverNetCentavos);
  return cap > 0 ? cap : 0;
}

export function calculateDriverNet(passengerFareCentavos, commissionCentavos) {
  const net = roundCentavos(passengerFareCentavos) - roundCentavos(commissionCentavos);
  return net > 0 ? net : 0;
}

/**
 * Computes the commission frozen for one ride.
 *
 * During the 60-day benefit (`commissionBps === 0`) the result is R$0.
 * Otherwise the fee is max(percentage, configured minimum), while preserving
 * the configured minimum driver net. An inconsistent future pricing table fails
 * closed instead of silently producing a zero or partial platform commission.
 */
export function calculateConfiguredCommissionCentavos({
  passengerFareCentavos,
  commissionBaseCentavos = passengerFareCentavos,
  commissionBps,
  vehiclePricing,
}) {
  const fare = roundCentavos(passengerFareCentavos);
  const bps = Number(commissionBps) || 0;
  const commissionCapCentavos = calculateCommissionCap(
    fare,
    vehiclePricing?.minimumDriverNetCentavos
  );

  if (bps <= 0) {
    return {
      ok: true,
      commissionCentavos: 0,
      commissionCapCentavos,
      minimumPlatformCommissionCentavos: 0,
      percentageCommissionCentavos: 0,
    };
  }

  const minimumPlatformCommissionCentavos = Math.max(
    0,
    roundCentavos(vehiclePricing?.minimumPlatformCommissionCentavos)
  );
  if (commissionCapCentavos < minimumPlatformCommissionCentavos) {
    return {
      ok: false,
      reason: 'INVALID_COMMISSION_CONFIGURATION',
      commissionCapCentavos,
      minimumPlatformCommissionCentavos,
    };
  }

  const percentageCommissionCentavos = calculatePlatformFeeCentavos(
    commissionBaseCentavos,
    bps
  );
  let commissionCentavos = Math.max(
    percentageCommissionCentavos,
    minimumPlatformCommissionCentavos
  );
  if (commissionCentavos > commissionCapCentavos) {
    commissionCentavos = commissionCapCentavos;
  }

  return {
    ok: true,
    commissionCentavos,
    commissionCapCentavos,
    minimumPlatformCommissionCentavos,
    percentageCommissionCentavos,
  };
}

export function applyDynamicPricing(baseFareCentavos, options = {}) {
  const base = roundCentavos(baseFareCentavos);
  const enabled = options.enabled === true;
  const maxMultiplier = options.maxMultiplier != null
    ? Number(options.maxMultiplier)
    : DYNAMIC_PRICING_MAX_MULTIPLIER;

  if (!enabled) {
    return { fareCentavos: base, surchargeCentavos: 0, multiplier: 1, enabled: false };
  }

  let multiplier = Number(options.multiplier);
  if (!(multiplier >= 1)) multiplier = 1;
  if (multiplier > maxMultiplier) multiplier = maxMultiplier;
  const fareCentavos = roundCentavos(base * multiplier);
  return {
    fareCentavos,
    surchargeCentavos: fareCentavos - base,
    multiplier,
    enabled: true,
  };
}

/**
 * Passenger discounts may spend only commission ABOVE the protected per-ride
 * minimum, then an explicit marketing budget. The driver's earning and the
 * DriveLocal minimum commission are never reduced outside the free window.
 */
export function applyPromotion(breakdown, promotion = {}, context = {}) {
  const passengerFare = roundCentavos(breakdown.passengerFareCentavos);
  const commission = roundCentavos(breakdown.commissionCentavos);
  const driverNet = roundCentavos(breakdown.driverNetCentavos);
  const discount = Math.max(0, roundCentavos(promotion.discountCentavos));
  const marketingBudget = Math.max(0, roundCentavos(promotion.marketingBudgetCentavos));
  const protectedMinimum = context.isCommissionFreePeriod
    ? 0
    : Math.max(
      0,
      roundCentavos(
        context.minimumPlatformCommissionCentavos
          ?? breakdown.minimumPlatformCommissionCentavos
          ?? 0
      )
    );

  const base = {
    passengerFareCentavos: passengerFare,
    commissionCentavos: commission,
    driverNetCentavos: driverNet,
    minimumPlatformCommissionCentavos: protectedMinimum,
    discountAppliedCentavos: 0,
    fundedByCommissionCentavos: 0,
    fundedByMarketingCentavos: 0,
    applied: false,
    reason: 'NONE',
  };

  if (discount <= 0) return { ...base, reason: 'NO_DISCOUNT' };
  if (context.isCommissionFreePeriod && marketingBudget <= 0) {
    return { ...base, reason: 'BLOCKED_COMMISSION_FREE_NO_BUDGET' };
  }

  const spendableCommission = Math.max(0, commission - protectedMinimum);
  const fromCommission = Math.min(discount, spendableCommission);
  const remainder = discount - fromCommission;
  const fromMarketing = Math.min(remainder, marketingBudget);
  const discountApplied = fromCommission + fromMarketing;
  const newCommission = commission - fromCommission;

  return {
    passengerFareCentavos: passengerFare - discountApplied,
    commissionCentavos: Math.max(protectedMinimum, newCommission),
    driverNetCentavos: driverNet,
    minimumPlatformCommissionCentavos: protectedMinimum,
    discountAppliedCentavos: discountApplied,
    fundedByCommissionCentavos: fromCommission,
    fundedByMarketingCentavos: fromMarketing,
    applied: discountApplied > 0,
    reason: discountApplied > 0 ? 'APPLIED' : 'NO_FUNDS',
  };
}

export function priceRide(input = {}) {
  const {
    serviceAreaId = DEFAULT_SERVICE_AREA_ID,
    vehicleType,
    distanceKm,
    durationMin = 0,
    driver = null,
    now = Date.now(),
    dynamic = null,
    promotion = null,
  } = input;

  const vehiclePricing = getVehiclePricing(serviceAreaId, vehicleType);
  if (!vehiclePricing) return { ok: false, reason: 'UNKNOWN_VEHICLE_OR_AREA' };
  if (!(Number(distanceKm) >= 0)) return { ok: false, reason: 'INVALID_DISTANCE' };
  if (!(Number(durationMin) >= 0)) return { ok: false, reason: 'INVALID_DURATION' };

  const baseFareCentavos = calculateBaseRideFare(vehiclePricing, distanceKm, durationMin);
  const dynamicResult = applyDynamicPricing(baseFareCentavos, dynamic || {});
  const passengerFareCentavos = applyFareMinimum(
    dynamicResult.fareCentavos,
    vehiclePricing.minimumPassengerFareCentavos
  );
  const commissionBps = calculateCommissionBps(
    vehicleType,
    distanceKm,
    driver,
    now,
    serviceAreaId
  );
  const commissionBaseCentavos = Math.max(
    0,
    passengerFareCentavos - dynamicResult.surchargeCentavos
  );
  const configuredCommission = calculateConfiguredCommissionCentavos({
    passengerFareCentavos,
    commissionBaseCentavos,
    commissionBps,
    vehiclePricing,
  });
  if (!configuredCommission.ok) {
    return { ok: false, reason: configuredCommission.reason };
  }

  const driverNetCentavos = calculateDriverNet(
    passengerFareCentavos,
    configuredCommission.commissionCentavos
  );

  let finalPassengerFare = passengerFareCentavos;
  let finalCommission = configuredCommission.commissionCentavos;
  let finalDriverNet = driverNetCentavos;
  let promotionResult = null;

  if (promotion) {
    promotionResult = applyPromotion(
      {
        passengerFareCentavos,
        commissionCentavos: configuredCommission.commissionCentavos,
        driverNetCentavos,
        minimumPlatformCommissionCentavos:
          configuredCommission.minimumPlatformCommissionCentavos,
      },
      promotion,
      {
        isCommissionFreePeriod: commissionBps === 0,
        minimumPlatformCommissionCentavos:
          configuredCommission.minimumPlatformCommissionCentavos,
      }
    );
    finalPassengerFare = promotionResult.passengerFareCentavos;
    finalCommission = promotionResult.commissionCentavos;
    finalDriverNet = promotionResult.driverNetCentavos;
  }

  return {
    ok: true,
    pricingConfigVersion: PRICING_CONFIG_VERSION,
    serviceAreaId,
    vehicleType,
    distanceKm: Number(distanceKm),
    durationMin: Number(durationMin),
    baseFareCentavos,
    dynamicEnabled: dynamicResult.enabled,
    dynamicMultiplier: dynamicResult.multiplier,
    dynamicSurchargeCentavos: dynamicResult.surchargeCentavos,
    passengerFareCentavos: finalPassengerFare,
    commissionBps,
    commissionCentavos: finalCommission,
    percentageCommissionCentavos:
      configuredCommission.percentageCommissionCentavos,
    minimumPlatformCommissionCentavos:
      configuredCommission.minimumPlatformCommissionCentavos,
    commissionCapCentavos: configuredCommission.commissionCapCentavos,
    driverNetCentavos: finalDriverNet,
    promotion: promotionResult,
  };
}

export function getRidePricing(
  vehicleType,
  distanceKm,
  serviceAreaResult,
  driver,
  now = Date.now()
) {
  if (
    serviceAreaResult
    && serviceAreaResult.status
    && serviceAreaResult.status !== 'ALLOWED'
  ) {
    return { ok: false, reason: serviceAreaResult.status };
  }

  const result = priceRide({
    vehicleType,
    distanceKm,
    durationMin: 0,
    driver,
    now,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    vehicleType: result.vehicleType,
    distanceKm: result.distanceKm,
    ridePriceCentavos: result.passengerFareCentavos,
    commissionBps: result.commissionBps,
    platformFeeCentavos: result.commissionCentavos,
    driverAmountCentavos: result.passengerFareCentavos,
  };
}
