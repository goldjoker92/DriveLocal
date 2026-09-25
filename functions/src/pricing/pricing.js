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
// A new snapshot version preserves V1.6 and earlier fares on existing rides.
const PRICING_CONFIG_VERSION = 'horizonte-1.7.0';

// Balanced pilot grid: a single kilometre rate at any distance and no evening
// surcharge. Historical ride snapshots are never repriced.
//
// After the commission-free benefit, every ride charges the advertised
// percentage: 12% moto and 15% car. minimumPlatformCommissionCentavos and
// minimumDriverNetCentavos are those same percentages applied to the minimum
// fare; priceRide fails closed if a future table ever breaks that invariant.
const CITY_PRICING = Object.freeze({
  HORIZONTE_CE_BR: {
    moto: {
      baseFareCentavos: 200,
      perKmCentavos: 85,
      perMinuteCentavos: 15,
      minimumPassengerFareCentavos: 500,
      normalCommissionBps: 1200,
      minimumPlatformCommissionCentavos: 60, // 12% of 500
      minimumDriverNetCentavos: 440, // 500 - 60
    },
    car: {
      baseFareCentavos: 300,
      perKmCentavos: 120,
      perMinuteCentavos: 20,
      minimumPassengerFareCentavos: 850,
      normalCommissionBps: 1500,
      minimumPlatformCommissionCentavos: 128, // rounded 15% of 850
      minimumDriverNetCentavos: 722, // 850 - 128
    },
  },
});

const DEFAULT_SERVICE_AREA_ID = 'HORIZONTE_CE_BR';

// The earlier pilot had no time-of-day surcharge. Keep its switch disabled so
// a quote at 19h costs exactly the same as one at 14h for the same route.
const PEAK = Object.freeze({
  enabled: false,
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

  // Named parts, so a surprising quote can be read line by line in a log or a
  // debugger instead of being one opaque multiplication.
  const distanceFareCentavos = vp.perKmCentavos * distanceKm;
  const timeFareCentavos = vp.perMinuteCentavos * durationMin;
  const rawFare = vp.baseFareCentavos + distanceFareCentavos + timeFareCentavos;

  // Peak is disabled for this grid. Keeping the quote fields stable
  // avoids changing the passenger contract while guaranteeing a zero surcharge.
  const peakApplied = isPeak(input.atMs);
  const peakMultiplierBps = peakApplied ? PEAK.multiplierBps : BPS_DENOMINATOR;
  const computedFare = roundCentavos((rawFare * peakMultiplierBps) / BPS_DENOMINATOR);
  const minimumApplied = computedFare < vp.minimumPassengerFareCentavos;
  const passengerFareCentavos = minimumApplied
    ? vp.minimumPassengerFareCentavos
    : computedFare;
  const regularFareCentavos = Math.max(vp.minimumPassengerFareCentavos, roundCentavos(rawFare));
  const peakSurchargeCentavos = Math.max(0, passengerFareCentavos - regularFareCentavos);

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
    peakSurchargeCentavos,
    peakMultiplierBps,
    fareBreakdown: {
      baseFareCentavos: vp.baseFareCentavos,
      distanceFareCentavos: roundCentavos(distanceFareCentavos),
      timeFareCentavos: roundCentavos(timeFareCentavos),
      minimumApplied,
    },
  };
}

module.exports = {
  priceRide,
  isPeak,
  PEAK,
  getVehiclePricing,
  PRICING_CONFIG_VERSION,
  BPS_DENOMINATOR,
  roundCentavos,
};
