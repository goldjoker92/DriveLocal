// Ride pricing helpers (DriveLocal V1).
//
// Pure functions over the pricing config. All money is INTEGER CENTAVOS.
// No Firestore, no side effects — safe to unit test and to call from the UI.
//
// Money flow reminder:
//   - ridePriceCentavos     : what the passenger pays the driver directly by Pix.
//   - platformFeeCentavos   : DriveLocal commission, debited from the driver
//                             wallet AFTER completion, only when commission applies.
//   - driverAmountCentavos  : what the driver keeps. With Pix-direct this equals
//                             ridePriceCentavos (the fee is taken from the wallet,
//                             not from the passenger's payment).

import {
  RIDE_PRICE_TIERS_CENTAVOS,
  COMMISSION_BPS,
  MOTO_SMALL_RIDE_MAX_KM,
} from '../constants/pricingConfig';
import { VEHICLE_MOTO, VEHICLE_CAR } from '../constants/vehicleTypes';

// Normalizes a Firestore Timestamp / Date / epoch-ms to epoch-ms (0 if absent).
function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

// Returns the ride price (centavos) for a vehicle type and distance.
// Boundary rule: the tier's maxKm is INCLUSIVE (see pricingConfig.js).
// Returns null when the vehicle type is unknown or the distance is invalid.
export function getRidePriceCentavos(vehicleType, distanceKm) {
  const tiers = RIDE_PRICE_TIERS_CENTAVOS[vehicleType];
  if (!tiers) {
    console.log('[PricingV1] unknown vehicleType=', vehicleType);
    return null;
  }
  const km = Number(distanceKm);
  if (!(km >= 0)) {
    console.log('[PricingV1] invalid distanceKm=', distanceKm);
    return null;
  }
  // First tier whose inclusive upper bound covers the distance.
  const tier = tiers.find((t) => km <= t.maxKm);
  console.log('[PricingV1] tier', vehicleType, km, 'km ->', tier.priceCentavos);
  return tier.priceCentavos;
}

// True while the driver is still inside the 0% commission launch window.
// Tolerates both field names used across the codebase (commissionFreeUntil is
// written for founders AND for #101+ after subscription activation; founder
// approval also writes founderExpiresAt).
function isCommissionFree(driver, nowMs) {
  const d = driver || {};
  const untilMs = toMillis(d.commissionFreeUntil || d.founderExpiresAt);
  return untilMs > 0 && nowMs < untilMs;
}

// Returns the commission rate (basis points) that applies to THIS ride, right now.
//
// Business rule: during the free launch period commission is always 0%. After it:
//   - Moto ride <= 5 km : 12% (1200 bps)
//   - Moto ride  > 5 km : 0%  (0 bps)
//   - Car ride (any)    : 15% (1500 bps)
export function calculateCommissionBps(vehicleType, distanceKm, driver, now = Date.now()) {
  const nowMs = toMillis(now) || now;

  if (isCommissionFree(driver, nowMs)) {
    console.log('[WalletCommission] commission-free window -> 0 bps');
    return COMMISSION_BPS.NONE;
  }

  if (vehicleType === VEHICLE_MOTO) {
    const bps = Number(distanceKm) <= MOTO_SMALL_RIDE_MAX_KM
      ? COMMISSION_BPS.MOTO_SMALL
      : COMMISSION_BPS.MOTO_LONG;
    console.log('[WalletCommission] moto', distanceKm, 'km ->', bps, 'bps');
    return bps;
  }

  if (vehicleType === VEHICLE_CAR) {
    console.log('[WalletCommission] car ->', COMMISSION_BPS.CAR, 'bps');
    return COMMISSION_BPS.CAR;
  }

  console.log('[WalletCommission] unknown vehicleType=', vehicleType, '-> 0 bps');
  return COMMISSION_BPS.NONE;
}

// Commission amount (centavos) from a ride price and a basis-points rate.
// Integer-only math: platformFee = round(price * bps / 10000).
export function calculatePlatformFeeCentavos(ridePriceCentavos, commissionBps) {
  const price = Number(ridePriceCentavos) || 0;
  const bps = Number(commissionBps) || 0;
  return Math.round((price * bps) / 10000);
}

// Full pricing breakdown for a ride.
//
// serviceAreaResult is the object returned by checkRideServiceArea (utils/
// serviceArea.js). When it is present and not ALLOWED, pricing is refused with
// a clear reason (never OUT_OF_RANGE for a valid ride inside Horizonte).
//
// Returns:
//   { ok: false, reason }                              -> out of service area
//   { ok: true, ridePriceCentavos, platformFeeCentavos,
//     driverAmountCentavos, commissionBps, ... }        -> priced
export function getRidePricing(vehicleType, distanceKm, serviceAreaResult, driver, now = Date.now()) {
  if (serviceAreaResult && serviceAreaResult.status && serviceAreaResult.status !== 'ALLOWED') {
    console.log('[PricingV1] refused, serviceArea status=', serviceAreaResult.status);
    return { ok: false, reason: serviceAreaResult.status };
  }

  const ridePriceCentavos = getRidePriceCentavos(vehicleType, distanceKm);
  if (ridePriceCentavos === null) {
    return { ok: false, reason: 'INVALID_RIDE_INPUT' };
  }

  const commissionBps = calculateCommissionBps(vehicleType, distanceKm, driver, now);
  const platformFeeCentavos = calculatePlatformFeeCentavos(ridePriceCentavos, commissionBps);

  return {
    ok: true,
    vehicleType,
    distanceKm: Number(distanceKm),
    ridePriceCentavos,
    commissionBps,
    platformFeeCentavos,
    // Pix-direct: the passenger pays the driver the full ride price. The fee is
    // taken later from the wallet, so the driver "amount" equals the ride price.
    driverAmountCentavos: ridePriceCentavos,
  };
}
