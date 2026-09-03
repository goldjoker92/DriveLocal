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
const PRICING_CONFIG_VERSION = 'horizonte-1.3.0';

// Competitive pilot grid for Horizonte. After the commission-free benefit,
// every ride charges the advertised percentage: 12% moto and 15% car. The
// minimum commission values are the rounded percentages of the minimum fares.
const CITY_PRICING = Object.freeze({
  HORIZONTE_CE_BR: {
    moto: {
      baseFareCentavos: 200,
      perKmCentavos: 85,
      perMinuteCentavos: 10,
      minimumPassengerFareCentavos: 500,
      normalCommissionBps: 1200,
      minimumPlatformCommissionCentavos: 60,
      minimumDriverNetCentavos: 440,
    },
    car: {
      baseFareCentavos: 300,
      perKmCentavos: 120,
      perMinuteCentavos: 15,
      minimumPassengerFareCentavos: 750,
      normalCommissionBps: 1500,
      minimumPlatformCommissionCentavos: 113,
      minimumDriverNetCentavos: 637,
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
 * Prices a ride from provider-measured distance/duration. The standard estimate
 * is max(vehicle percentage, minimum platform commission), capped only after a
 * fail-closed configuration check proving that the minimum driver net can still
 * be preserved. The per-driver 0% launch adjustment is applied at acceptance.
 * @param {{serviceAreaId?:string, vehicleType:string, distanceKm:number, durationMin:number}} input
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

  const rawFare = vp.baseFareCentavos + vp.perKmCentavos * distanceKm + vp.perMinuteCentavos * durationMin;
  const baseFare = roundCentavos(rawFare);
  const passengerFareCentavos = baseFare < vp.minimumPassengerFareCentavos
    ? vp.minimumPassengerFareCentavos
    : baseFare;

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
  };
}

module.exports = {
  priceRide,
  getVehiclePricing,
  PRICING_CONFIG_VERSION,
  BPS_DENOMINATOR,
  roundCentavos,
};
