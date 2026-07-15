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
const PRICING_CONFIG_VERSION = 'horizonte-1.1.0';

// Per-vehicle fare + commission model (Horizonte-CE, governance D3).
const CITY_PRICING = Object.freeze({
  HORIZONTE_CE_BR: {
    moto: {
      baseFareCentavos: 250,
      perKmCentavos: 95,
      perMinuteCentavos: 12,
      minimumPassengerFareCentavos: 500,
      normalCommissionBps: 1200,
      minimumDriverNetCentavos: 500,
    },
    car: {
      baseFareCentavos: 350,
      perKmCentavos: 135,
      perMinuteCentavos: 20,
      minimumPassengerFareCentavos: 800,
      normalCommissionBps: 1500,
      minimumDriverNetCentavos: 800,
    },
  },
});

const DEFAULT_SERVICE_AREA_ID = 'HORIZONTE_CE_BR';

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
 * Prices a ride from provider-measured distance/duration. Commission is the
 * NORMAL (standard) rate for the vehicle — the passenger-facing estimate — capped
 * to preserve the minimum driver net and never negative. The per-driver 0%
 * commission-free adjustment is applied at acceptance, not here.
 * @param {{serviceAreaId?:string, vehicleType:string, distanceKm:number, durationMin:number}} input
 * @returns {{ok:false, reason:string}|{ok:true, pricingConfigVersion:string, passengerFareCentavos:number, commissionCentavos:number, driverNetCentavos:number, commissionBps:number}}
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

  const rawFare = vp.baseFareCentavos + vp.perKmCentavos * distanceKm + vp.perMinuteCentavos * durationMin;
  const baseFare = roundCentavos(rawFare);
  const passengerFareCentavos = baseFare < vp.minimumPassengerFareCentavos ? vp.minimumPassengerFareCentavos : baseFare;

  let commissionCentavos = roundCentavos((passengerFareCentavos * vp.normalCommissionBps) / BPS_DENOMINATOR);
  // Cap so the driver keeps at least the minimum net; never negative.
  const cap = Math.max(0, passengerFareCentavos - vp.minimumDriverNetCentavos);
  if (commissionCentavos > cap) commissionCentavos = cap;
  if (commissionCentavos < 0) commissionCentavos = 0;

  return {
    ok: true,
    pricingConfigVersion: PRICING_CONFIG_VERSION,
    passengerFareCentavos,
    commissionCentavos,
    driverNetCentavos: Math.max(0, passengerFareCentavos - commissionCentavos),
    commissionBps: vp.normalCommissionBps,
  };
}

module.exports = { priceRide, getVehiclePricing, PRICING_CONFIG_VERSION, BPS_DENOMINATOR, roundCentavos };
