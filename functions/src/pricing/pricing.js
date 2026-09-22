// @ts-check
// Backend authoritative ride pricing — mirrors the app BLOCK 01 model
// (src/constants/pricingConfig.js + src/utils/ridePricing.js) so the server,
// never the client, decides fares and commission. Pure functions, integer
// centavos, deterministic HALF-UP rounding. Dynamic pricing and promotions are
// intentionally excluded here (disabled in V1).
//
// The client NEVER supplies fare/commission/distance/duration authority: these
// come from the routing provider (distance/duration) and this module (money).

const BPS_DENOMINATOR = 10000;

// Bump when fares/commission change so historical rides keep their snapshot.
const PRICING_CONFIG_VERSION = 'horizonte-1.5.0';

// Competitive pilot grid for Horizonte (v1.5). Three fixes over the launch
// grid, all measured on real September rides:
//   1. per-minute was R$0,10 — a 25-minute ride paid the driver R$2,50 for his
//      time, about R$6/hour. Now R$0,20 moto / R$0,30 car.
//   2. a single flat per-km made long rides a loss, because the driver rides
//      back empty. Kilometres past LONG_RIDE_FROM_KM now cost more.
//   3. nothing rewarded the 18h-22h window, where demand peaks and almost
//      nobody is online: that window now carries a +20% surcharge (see PEAK).
// Short neighbourhood rides stay on the minimum fare on purpose: they are the
// most frequent ones and must remain cheaper than a local mototaxi.
//
// After the commission-free benefit, every ride charges the advertised
// percentage: 12% moto and 15% car. minimumPlatformCommissionCentavos and
// minimumDriverNetCentavos are those same percentages applied to the minimum
// fare; priceRide fails closed if a future table ever breaks that invariant.
const CITY_PRICING = Object.freeze({
  HORIZONTE_CE_BR: {
    moto: {
      baseFareCentavos: 250,
      perKmCentavos: 100,
      // Charged only on the kilometres past LONG_RIDE_FROM_KM.
      longRidePerKmCentavos: 130,
      perMinuteCentavos: 20,
      minimumPassengerFareCentavos: 600,
      normalCommissionBps: 1200,
      minimumPlatformCommissionCentavos: 72, // 12% of 600
      minimumDriverNetCentavos: 528, // 600 - 72
    },
    car: {
      baseFareCentavos: 350,
      perKmCentavos: 140,
      longRidePerKmCentavos: 175,
      perMinuteCentavos: 30,
      minimumPassengerFareCentavos: 850,
      normalCommissionBps: 1500,
      minimumPlatformCommissionCentavos: 128, // 15% of 850
      minimumDriverNetCentavos: 722, // 850 - 128
    },
  },
});

const DEFAULT_SERVICE_AREA_ID = 'HORIZONTE_CE_BR';

// The first kilometres stay on the cheap rate; only the surplus above this
// threshold is billed at longRidePerKmCentavos.
const LONG_RIDE_FROM_KM = 3;

// Horizonte evening peak (local time, UTC-3 all year). `enabled` is the only
// switch: quotes, ride snapshots and commission all follow, server side, with
// no app build. Turned ON on 2026-09-22 to pull drivers into the 18h-22h
// window, where demand peaks and almost nobody is online. Set it back to false
// if passenger demand drops in that window — the change is one deploy.
const PEAK = Object.freeze({
  enabled: true,
  fromHour: 18,
  toHour: 22, // 18:00 -> 21:59 local
  multiplierBps: 12000, // 1.20x
});

const LOCAL_OFFSET_MS = -3 * 60 * 60 * 1000;

/**
 * Local Horizonte hour (0-23) for an epoch-ms instant.
 * @param {number} atMs
 */
function localHour(atMs) {
  return new Date(Number(atMs) + LOCAL_OFFSET_MS).getUTCHours();
}

/**
 * True when `atMs` is inside the peak window AND the surcharge is enabled.
 * A missing or invalid instant is never peak, so any caller without a clock
 * (tests, replays, back-office quotes) deterministically gets the plain fare.
 * @param {number|null|undefined} atMs
 */
function isPeak(atMs) {
  if (!PEAK.enabled) return false;
  // null/0 are "no clock", not the epoch: Number(null) is 0 and would resolve
  // to a real hour, silently surcharging callers that never passed a time.
  if (atMs === null || atMs === undefined) return false;
  if (!Number.isFinite(Number(atMs)) || Number(atMs) <= 0) return false;
  const hour = localHour(Number(atMs));
  return hour >= PEAK.fromHour && hour < PEAK.toHour;
}

/**
 * Splits a distance into the cheap first kilometres and the long-ride surplus.
 * Exported so a surprising fare can be checked part by part.
 * @param {number} distanceKm
 * @returns {{shortKm:number, longKm:number}}
 */
function splitDistance(distanceKm) {
  const shortKm = Math.min(distanceKm, LONG_RIDE_FROM_KM);
  return { shortKm, longKm: Math.max(0, distanceKm - LONG_RIDE_FROM_KM) };
}

function roundCentavos(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function getVehiclePricing(serviceAreaId, vehicleType) {
  const city = CITY_PRICING[serviceAreaId] || CITY_PRICING[DEFAULT_SERVICE_AREA_ID];
  if (!city) return null;
  return city[vehicleType] || null;
}

/**
 * Prices a ride from provider-measured distance/duration. The standard estimate
 * is max(vehicle percentage, minimum platform commission), capped only after a
 * fail-closed configuration check proving that the minimum driver net can still
 * be preserved. The per-driver 0% launch adjustment is applied at acceptance.
 * @param {{serviceAreaId?:string, vehicleType:string, distanceKm:number, durationMin:number, atMs?:number}} input
 * @returns {{ok:false, reason:string}|{ok:true, pricingConfigVersion:string, passengerFareCentavos:number, commissionCentavos:number, minimumPlatformCommissionCentavos:number, driverNetCentavos:number, commissionBps:number}}
 */
function priceRide(input = {}) {
  const serviceAreaId = input.serviceAreaId || DEFAULT_SERVICE_AREA_ID;
  const { vehicleType } = input;
  const distanceKm = Number(input.distanceKm);
  const durationMin = Number(input.durationMin);

  const vp = getVehiclePricing(serviceAreaId, vehicleType);
  if (!vp) return { ok: false, reason: 'UNKNOWN_VEHICLE_OR_AREA' };
  if (!(distanceKm >= 0)) return { ok: false, reason: 'INVALID_DISTANCE' };
  if (!(durationMin >= 0)) return { ok: false, reason: 'INVALID_DURATION' };

  const { shortKm, longKm } = splitDistance(distanceKm);
  const longPerKmCentavos = Number.isFinite(Number(vp.longRidePerKmCentavos))
    ? vp.longRidePerKmCentavos
    : vp.perKmCentavos;

  // Named parts, so a surprising quote can be read line by line in a log or a
  // debugger instead of being one opaque multiplication.
  const distanceFareCentavos = vp.perKmCentavos * shortKm + longPerKmCentavos * longKm;
  const timeFareCentavos = vp.perMinuteCentavos * durationMin;
  const rawFare = vp.baseFareCentavos + distanceFareCentavos + timeFareCentavos;

  // The peak multiplier applies BEFORE the minimum: a minimum-fare ride stays
  // exactly at the minimum, only real rides carry the surcharge.
  const peakApplied = isPeak(input.atMs);
  const peakMultiplierBps = peakApplied ? PEAK.multiplierBps : BPS_DENOMINATOR;
  const computedFare = roundCentavos((rawFare * peakMultiplierBps) / BPS_DENOMINATOR);
  const minimumApplied = computedFare < vp.minimumPassengerFareCentavos;
  const passengerFareCentavos = minimumApplied
    ? vp.minimumPassengerFareCentavos
    : computedFare;

  const minimumPlatformCommissionCentavos = Math.max(
    0,
    roundCentavos(vp.minimumPlatformCommissionCentavos)
  );
  const commissionCapCentavos = Math.max(
    0,
    passengerFareCentavos - vp.minimumDriverNetCentavos
  );

  // Never silently create a standard ride that cannot fund both the configured
  // DriveLocal minimum and the guaranteed driver net. A bad future table blocks
  // quoting instead of degrading to a zero/partial commission.
  if (commissionCapCentavos < minimumPlatformCommissionCentavos) {
    return { ok: false, reason: 'INVALID_COMMISSION_CONFIGURATION' };
  }

  const percentageCommissionCentavos = roundCentavos(
    (passengerFareCentavos * vp.normalCommissionBps) / BPS_DENOMINATOR
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
    pricingConfigVersion: PRICING_CONFIG_VERSION,
    passengerFareCentavos,
    commissionCentavos,
    minimumPlatformCommissionCentavos,
    driverNetCentavos: passengerFareCentavos - commissionCentavos,
    commissionBps: vp.normalCommissionBps,
    peakApplied,
    peakMultiplierBps,
    fareBreakdown: {
      baseFareCentavos: vp.baseFareCentavos,
      distanceFareCentavos: roundCentavos(distanceFareCentavos),
      timeFareCentavos: roundCentavos(timeFareCentavos),
      shortKm,
      longKm,
      minimumApplied,
    },
  };
}

module.exports = {
  priceRide,
  isPeak,
  splitDistance,
  LONG_RIDE_FROM_KM,
  PEAK,
  getVehiclePricing,
  PRICING_CONFIG_VERSION,
  BPS_DENOMINATOR,
  roundCentavos,
};
