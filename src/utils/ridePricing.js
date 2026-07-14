// @ts-check
// Ride pricing domain (DriveLocal V1.1, governance D3).
//
// PURE functions over the pricing config — no Firestore, no side effects,
// deterministic and unit-testable. All money is INTEGER CENTAVOS. `now` is
// injected everywhere time matters so tests never depend on the wall clock.
//
// Money flow (V1 Pix-direct model):
//   passengerFareCentavos : what the passenger pays the driver DIRECTLY by Pix
//                           (the driver receives the full fare).
//   commissionCentavos    : DriveLocal platform fee, later debited from the
//                           driver's prepaid wallet at completion. Capped to
//                           preserve the minimum driver net; never negative.
//   driverNetCentavos     : passengerFare - commission = the driver's effective
//                           take-home / guaranteed earning (>= minimumDriverNet).
//
// Rounding rule: roundCentavos() = HALF-UP on non-negative amounts (Math.round;
// ties go up). Inputs baseFare/perKm/perMinute are integer centavos; distanceKm
// and durationMin may be fractional.

import {
  getVehiclePricing,
  BPS_DENOMINATOR,
  DYNAMIC_PRICING_MAX_MULTIPLIER,
  PRICING_CONFIG_VERSION,
  DEFAULT_SERVICE_AREA_ID,
} from '../constants/pricingConfig';

// Deterministic rounding to an integer centavo (half-up on non-negative values).
export function roundCentavos(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

// Normalizes a Firestore Timestamp / Date / epoch-ms to epoch-ms (0 if absent).
export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * Base ride fare BEFORE the passenger minimum, in integer centavos.
 *   fare = base + perKm * distanceKm + perMinute * durationMin   (then rounded)
 * Negative/invalid distance or duration are treated as 0. Returns 0 when the
 * vehicle pricing block is missing.
 * @param {object} vehiclePricing pricing block from getVehiclePricing()
 * @param {number} distanceKm
 * @param {number} durationMin
 * @returns {number} integer centavos
 */
export function calculateBaseRideFare(vehiclePricing, distanceKm, durationMin) {
  if (!vehiclePricing) return 0;
  const km = Number(distanceKm);
  const min = Number(durationMin);
  const safeKm = km >= 0 ? km : 0;
  const safeMin = min >= 0 ? min : 0;
  const raw =
    vehiclePricing.baseFareCentavos +
    vehiclePricing.perKmCentavos * safeKm +
    vehiclePricing.perMinuteCentavos * safeMin;
  return roundCentavos(raw);
}

/**
 * Enforces the per-vehicle minimum passenger fare.
 * @returns {number} max(fare, minimum) in integer centavos
 */
export function applyFareMinimum(fareCentavos, minimumPassengerFareCentavos) {
  const fare = roundCentavos(fareCentavos);
  const min = roundCentavos(minimumPassengerFareCentavos);
  return fare < min ? min : fare;
}

/**
 * True while the driver is inside the 0% commission window (launch/founder).
 * Boundary is EXCLUSIVE at the exact expiry instant: at now === commissionFreeUntil
 * the ride is already commissionable. Tolerates commissionFreeUntil OR the
 * founder alias founderExpiresAt.
 * @param {object} driver
 * @param {number|Date} [now]
 */
export function isCommissionFree(driver, now = Date.now()) {
  const d = driver || {};
  const nowMs = toMillis(now) || now;
  const untilMs = toMillis(d.commissionFreeUntil || d.founderExpiresAt);
  return untilMs > 0 && nowMs < untilMs;
}

/**
 * Commission rate (basis points) that applies to THIS ride right now.
 * 0 during the commission-free window; otherwise the vehicle's normal rate
 * (moto 1200, car 1500).
 *
 * NOTE: `distanceKm` is accepted for backward-compatibility with existing callers
 * (walletCommission, driverEligibility) but NO LONGER affects the rate — the old
 * "moto rides over 5 km = 0%" rule was removed in D3. Unknown vehicle -> 0.
 * @param {string} vehicleType
 * @param {number} [distanceKm] ignored; kept for signature compatibility
 * @param {object} driver
 * @param {number|Date} [now]
 * @param {string} [serviceAreaId]
 * @returns {number} basis points
 */
export function calculateCommissionBps(
  vehicleType,
  distanceKm,
  driver,
  now = Date.now(),
  serviceAreaId = DEFAULT_SERVICE_AREA_ID
) {
  if (isCommissionFree(driver, now)) return 0;
  const vp = getVehiclePricing(serviceAreaId, vehicleType);
  return vp ? vp.normalCommissionBps : 0;
}

/**
 * Commission amount (centavos) from a fare and a basis-points rate.
 * Integer-only, floored at 0 (never negative).
 */
export function calculatePlatformFeeCentavos(fareCentavos, commissionBps) {
  const fare = roundCentavos(fareCentavos);
  const bps = Number(commissionBps) || 0;
  const fee = roundCentavos((fare * bps) / BPS_DENOMINATOR);
  return fee < 0 ? 0 : fee;
}

/**
 * Maximum commission (centavos) that still leaves the driver at least
 * minimumDriverNetCentavos:  cap = max(0, passengerFare - minimumDriverNet).
 * Never negative.
 */
export function calculateCommissionCap(passengerFareCentavos, minimumDriverNetCentavos) {
  const fare = roundCentavos(passengerFareCentavos);
  const minNet = roundCentavos(minimumDriverNetCentavos);
  const cap = fare - minNet;
  return cap > 0 ? cap : 0;
}

/**
 * Driver net take-home:  passengerFare - commission, floored at 0.
 */
export function calculateDriverNet(passengerFareCentavos, commissionCentavos) {
  const fare = roundCentavos(passengerFareCentavos);
  const commission = roundCentavos(commissionCentavos);
  const net = fare - commission;
  return net > 0 ? net : 0;
}

/**
 * Applies an optional dynamic-pricing multiplier to the base passenger fare.
 * Disabled by default. When enabled the multiplier is clamped to
 * [1.0, maxMultiplier] (default 1.20). The surcharge (newFare - baseFare)
 * belongs ENTIRELY to the driver (pilot rule): it is added to the passenger fare
 * and flows into the driver net, and commission is NOT charged on it.
 * @param {number} baseFareCentavos
 * @param {{enabled?:boolean, multiplier?:number, maxMultiplier?:number}} [options]
 * @returns {{fareCentavos:number, surchargeCentavos:number, multiplier:number, enabled:boolean}}
 */
export function applyDynamicPricing(baseFareCentavos, options = {}) {
  const base = roundCentavos(baseFareCentavos);
  const enabled = options.enabled === true;
  const maxM =
    options.maxMultiplier != null ? Number(options.maxMultiplier) : DYNAMIC_PRICING_MAX_MULTIPLIER;

  if (!enabled) {
    return { fareCentavos: base, surchargeCentavos: 0, multiplier: 1, enabled: false };
  }

  let m = Number(options.multiplier);
  if (!(m >= 1)) m = 1; //          never below 1.0
  if (m > maxM) m = maxM; //         clamp to the configured maximum (1.20)
  const fare = roundCentavos(base * m);
  return { fareCentavos: fare, surchargeCentavos: fare - base, multiplier: m, enabled: true };
}

/**
 * Applies a passenger discount, funded by DriveLocal margin (commission) FIRST,
 * then by an explicit marketing budget. Invariants (D3):
 *   - the driver's guaranteed earning (driverNet) NEVER decreases;
 *   - commission NEVER goes negative (floored at 0);
 *   - during the 0% commission window an automatic promotion is NOT applied
 *     unless an explicit marketingBudgetCentavos is supplied (no margin to spend).
 * Any discount beyond commission + marketing budget is simply NOT granted (we
 * never reduce the driver's earning to fund a promotion).
 *
 * @param {{passengerFareCentavos:number, commissionCentavos:number, driverNetCentavos:number}} breakdown
 * @param {{discountCentavos?:number, marketingBudgetCentavos?:number}} [promotion]
 * @param {{isCommissionFreePeriod?:boolean}} [context]
 */
export function applyPromotion(breakdown, promotion = {}, context = {}) {
  const passengerFare = roundCentavos(breakdown.passengerFareCentavos);
  const commission = roundCentavos(breakdown.commissionCentavos);
  const driverNet = roundCentavos(breakdown.driverNetCentavos);

  const discount = Math.max(0, roundCentavos(promotion.discountCentavos));
  const marketingBudget = Math.max(0, roundCentavos(promotion.marketingBudgetCentavos));

  const base = {
    passengerFareCentavos: passengerFare,
    commissionCentavos: commission,
    driverNetCentavos: driverNet, //  guaranteed earning is never touched
    discountAppliedCentavos: 0,
    fundedByCommissionCentavos: 0,
    fundedByMarketingCentavos: 0,
    applied: false,
    reason: 'NONE',
  };

  if (discount <= 0) return { ...base, reason: 'NO_DISCOUNT' };

  // No automatic promotion during the 0% commission window unless funded by an
  // explicit marketing budget (there is no platform margin to spend).
  if (context.isCommissionFreePeriod && marketingBudget <= 0) {
    return { ...base, reason: 'BLOCKED_COMMISSION_FREE_NO_BUDGET' };
  }

  const fromCommission = Math.min(discount, commission); //   spend margin first
  const remainder = discount - fromCommission;
  const fromMarketing = Math.min(remainder, marketingBudget); // then the budget
  const discountApplied = fromCommission + fromMarketing;
  const newCommission = commission - fromCommission; //        >= 0 by construction

  return {
    passengerFareCentavos: passengerFare - discountApplied,
    commissionCentavos: newCommission < 0 ? 0 : newCommission,
    driverNetCentavos: driverNet,
    discountAppliedCentavos: discountApplied,
    fundedByCommissionCentavos: fromCommission,
    fundedByMarketingCentavos: fromMarketing,
    applied: discountApplied > 0,
    reason: discountApplied > 0 ? 'APPLIED' : 'NO_FUNDS',
  };
}

/**
 * Full pricing breakdown + IMMUTABLE snapshot for a ride (persist this on the
 * ride document). Pure. Commission is charged on the fare EXCLUDING the dynamic
 * surcharge (the surcharge belongs to the driver), then capped to preserve the
 * minimum driver net.
 *
 * @param {{
 *   serviceAreaId?:string, vehicleType:string, distanceKm:number,
 *   durationMin?:number, driver?:object, now?:number|Date,
 *   dynamic?:{enabled?:boolean, multiplier?:number},
 *   promotion?:{discountCentavos?:number, marketingBudgetCentavos?:number}
 * }} input
 * @returns {object} { ok:false, reason } OR the priced snapshot { ok:true, ... }
 */
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

  const vp = getVehiclePricing(serviceAreaId, vehicleType);
  if (!vp) return { ok: false, reason: 'UNKNOWN_VEHICLE_OR_AREA' };
  if (!(Number(distanceKm) >= 0)) return { ok: false, reason: 'INVALID_DISTANCE' };
  if (!(Number(durationMin) >= 0)) return { ok: false, reason: 'INVALID_DURATION' };

  const baseFareCentavos = calculateBaseRideFare(vp, distanceKm, durationMin);
  const dyn = applyDynamicPricing(baseFareCentavos, dynamic || {});
  const passengerFareCentavos = applyFareMinimum(dyn.fareCentavos, vp.minimumPassengerFareCentavos);

  const commissionBps = calculateCommissionBps(vehicleType, distanceKm, driver, now, serviceAreaId);
  // Charge commission on the fare minus the driver-owned dynamic surcharge.
  const commissionBase = Math.max(0, passengerFareCentavos - dyn.surchargeCentavos);
  let commissionCentavos = calculatePlatformFeeCentavos(commissionBase, commissionBps);
  const commissionCapCentavos = calculateCommissionCap(passengerFareCentavos, vp.minimumDriverNetCentavos);
  if (commissionCentavos > commissionCapCentavos) commissionCentavos = commissionCapCentavos;
  let driverNetCentavos = calculateDriverNet(passengerFareCentavos, commissionCentavos);

  let promotionResult = null;
  let finalPassengerFare = passengerFareCentavos;
  let finalCommission = commissionCentavos;
  let finalDriverNet = driverNetCentavos;
  if (promotion) {
    promotionResult = applyPromotion(
      {
        passengerFareCentavos,
        commissionCentavos,
        driverNetCentavos,
      },
      promotion,
      { isCommissionFreePeriod: commissionBps === 0 }
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
    dynamicEnabled: dyn.enabled,
    dynamicMultiplier: dyn.multiplier,
    dynamicSurchargeCentavos: dyn.surchargeCentavos,
    passengerFareCentavos: finalPassengerFare,
    commissionBps,
    commissionCentavos: finalCommission,
    commissionCapCentavos,
    driverNetCentavos: finalDriverNet,
    promotion: promotionResult,
  };
}

/**
 * Backward-compatibility shim for confirm-price.jsx (Step 1). Prefer priceRide()
 * for all new code. `serviceAreaResult` is the checkRideServiceArea() output; a
 * non-ALLOWED status refuses pricing. durationMin defaults to 0 until BLOCK 07
 * wires real route duration.
 *
 * Pix-direct semantics preserved: driverAmountCentavos is the FULL fare the
 * passenger pays the driver by Pix (commission is a separate wallet debit).
 * TODO(BLOCK 07): replace call sites with priceRide() once real route
 * distance + duration are available.
 */
export function getRidePricing(vehicleType, distanceKm, serviceAreaResult, driver, now = Date.now()) {
  if (serviceAreaResult && serviceAreaResult.status && serviceAreaResult.status !== 'ALLOWED') {
    return { ok: false, reason: serviceAreaResult.status };
  }
  const r = priceRide({ vehicleType, distanceKm, durationMin: 0, driver, now });
  if (!r.ok) return { ok: false, reason: r.reason };
  return {
    ok: true,
    vehicleType: r.vehicleType,
    distanceKm: r.distanceKm,
    ridePriceCentavos: r.passengerFareCentavos,
    commissionBps: r.commissionBps,
    platformFeeCentavos: r.commissionCentavos,
    // Pix-direct: the passenger pays the driver the full fare; the fee is taken
    // later from the wallet, so the driver "amount" received equals the fare.
    driverAmountCentavos: r.passengerFareCentavos,
  };
}
