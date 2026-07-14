// @ts-check
// DriveLocal V1.1 pricing configuration (governance D3).
//
// SINGLE SOURCE OF TRUTH for fares, commission, the wallet threshold,
// subscription prices, promotions, dynamic pricing and operating mode.
// All money is INTEGER CENTAVOS (BRL cents) — never floats.
//
// Deterministic rounding rule: every monetary result is rounded to the nearest
// integer centavo using HALF-UP rounding on non-negative amounts, implemented as
// Math.round(x) (ties go up, e.g. 702.5 -> 703). Fare inputs
// (baseFare/perKm/perMinute/minimums) are integer centavos; distanceKm and
// durationMin may be fractional. See utils/ridePricing.js roundCentavos().
//
// Multi-city: pricing is keyed by serviceAreaId so new cities are added here
// without touching the money formulas. Every priced ride must persist an
// immutable snapshot carrying pricingConfigVersion (see utils/ridePricing.priceRide).

import { VEHICLE_MOTO, VEHICLE_CAR } from './vehicleTypes';

// Bump on ANY change to fares/commission so historical rides keep the pricing
// they were created with, even after these tables change.
export const PRICING_CONFIG_VERSION = 'horizonte-1.1.0';

// Backward-compatible alias — confirm-price.jsx (Step 1) imports PRICING_VERSION.
export const PRICING_VERSION = PRICING_CONFIG_VERSION;

// Basis-points denominator (1 bps = 0.01%; 1200 bps = 12%, 1500 bps = 15%).
export const BPS_DENOMINATOR = 10000;

// ---------------------------------------------------------------------------
// Per-vehicle fare + commission model — Horizonte-CE (D3)
// ---------------------------------------------------------------------------
// NOTE (D3): the old distance-tier model AND the "moto rides over 5 km pay 0%
// commission" rule are REMOVED. Commission is now a flat per-vehicle bps rate,
// capped only to preserve the minimum driver net.
export const HORIZONTE_VEHICLE_PRICING = {
  [VEHICLE_MOTO]: {
    baseFareCentavos: 250,
    perKmCentavos: 95,
    perMinuteCentavos: 12,
    minimumPassengerFareCentavos: 500,
    normalCommissionBps: 1200, // 12%
    minimumDriverNetCentavos: 500,
  },
  [VEHICLE_CAR]: {
    baseFareCentavos: 350,
    perKmCentavos: 135,
    perMinuteCentavos: 20,
    minimumPassengerFareCentavos: 800,
    normalCommissionBps: 1500, // 15%
    minimumDriverNetCentavos: 800,
  },
};

// City-keyed pricing (multi-city ready). Add new serviceAreaIds here only.
export const CITY_PRICING = {
  HORIZONTE_CE_BR: {
    serviceAreaId: 'HORIZONTE_CE_BR',
    pricingConfigVersion: PRICING_CONFIG_VERSION,
    vehicles: HORIZONTE_VEHICLE_PRICING,
  },
};

export const DEFAULT_SERVICE_AREA_ID = 'HORIZONTE_CE_BR';

// Returns the per-vehicle pricing block for a service area, or null when the
// service area / vehicle type is unknown. Falls back to the default service area
// so a missing serviceAreaId never crashes pricing (V1 is single-city).
export function getVehiclePricing(serviceAreaId, vehicleType) {
  const city = CITY_PRICING[serviceAreaId] || CITY_PRICING[DEFAULT_SERVICE_AREA_ID];
  if (!city) return null;
  return city.vehicles[vehicleType] || null;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------
// Minimum prepaid wallet balance (centavos) a standard driver must keep to
// receive rides where commission may apply. Kept consistent with the existing
// wallet fallback threshold (WALLET_FALLBACK_LOW_THRESHOLD_CENTS = 300 = R$3,00).
export const MIN_WALLET_BALANCE_CENTAVOS = 300;

// ---------------------------------------------------------------------------
// Subscription (centavos / month) — charged only AFTER the free period
// ---------------------------------------------------------------------------
export const SUBSCRIPTION_MONTHLY_CENTAVOS = {
  [VEHICLE_MOTO]: 990, //  R$ 9,90 / month
  [VEHICLE_CAR]: 1990, //  R$ 19,90 / month
};

// A paid subscription period lasts 30 rolling days.
export const SUBSCRIPTION_PERIOD_DAYS = 30;

// Non-founder drivers may complete this many finalized rides before an active
// subscription is required (an active subscription is required from the 6th
// completed ride onward). Independent from the commission-free period.
export const NON_FOUNDER_FREE_RIDES = 5;

// Free launch windows measured from the ADMIN APPROVAL date (approvedAt).
export const FOUNDER_FREE_DAYS = 60; //     first 100 approved drivers
export const COMMISSION_FREE_DAYS = 60; //  commission is 0% for everyone for 60 days

// ---------------------------------------------------------------------------
// Dynamic pricing (D3) — disabled by default
// ---------------------------------------------------------------------------
// During the pilot, any dynamic surcharge belongs ENTIRELY to the driver
// (see utils/ridePricing.applyDynamicPricing).
export const DYNAMIC_PRICING_DEFAULT_ENABLED = false;
export const DYNAMIC_PRICING_MAX_MULTIPLIER = 1.2;

// ---------------------------------------------------------------------------
// Operating mode (D3) — 24/7 by default, optional scheduled mode
// ---------------------------------------------------------------------------
// No driver-count threshold ever gates availability.
export const OPERATING_MODE = {
  ALWAYS: '24_7',
  SCHEDULED: 'scheduled',
};
export const DEFAULT_OPERATING_MODE = OPERATING_MODE.ALWAYS;
