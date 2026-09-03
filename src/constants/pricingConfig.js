// @ts-check
// DriveLocal V1.3 pricing configuration (governance D3).
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
export const PRICING_CONFIG_VERSION = 'horizonte-1.3.0';

// Backward-compatible alias — confirm-price.jsx (Step 1) imports PRICING_VERSION.
export const PRICING_VERSION = PRICING_CONFIG_VERSION;

// Basis-points denominator (1 bps = 0.01%; 1200 bps = 12%, 1500 bps = 15%).
export const BPS_DENOMINATOR = 10000;

// ---------------------------------------------------------------------------
// Per-vehicle fare + commission model — Horizonte-CE (D3)
// ---------------------------------------------------------------------------
// Competitive pilot grid for Horizonte. After the commission-free benefit,
// every ride charges the advertised percentage: 12% moto and 15% car. The
// minimum commission values below are the rounded percentages of each vehicle's
// minimum fare, and the driver-net floors make the configuration fail closed if
// a future change would prevent that commission from being collected.
export const HORIZONTE_VEHICLE_PRICING = {
  [VEHICLE_MOTO]: {
    baseFareCentavos: 200,
    perKmCentavos: 85,
    perMinuteCentavos: 10,
    minimumPassengerFareCentavos: 500,
    normalCommissionBps: 1200, // 12%
    minimumPlatformCommissionCentavos: 60,
    minimumDriverNetCentavos: 440,
  },
  [VEHICLE_CAR]: {
    baseFareCentavos: 300,
    perKmCentavos: 120,
    perMinuteCentavos: 15,
    minimumPassengerFareCentavos: 750,
    normalCommissionBps: 1500, // 15%
    minimumPlatformCommissionCentavos: 113,
    minimumDriverNetCentavos: 637,
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
// Subscription (centavos / month)
// ---------------------------------------------------------------------------
export const SUBSCRIPTION_MONTHLY_CENTAVOS = {
  [VEHICLE_MOTO]: 990, //  R$ 9,90 / month
  [VEHICLE_CAR]: 1990, //  R$ 19,90 / month
};

// A paid subscription period lasts 30 rolling days.
export const SUBSCRIPTION_PERIOD_DAYS = 30;

// Drivers #101+ may complete at most five rides without subscription, only while
// the same 60-day launch window is active. From the 6th ride OR at day 60
// (whichever happens first), an active subscription is required.
export const NON_FOUNDER_FREE_RIDES = 5;

// Free launch windows measured from the immutable ADMIN APPROVAL date.
export const FOUNDER_FREE_DAYS = 60; // subscription-free for founders #1..#100
export const COMMISSION_FREE_DAYS = 60; // 0% commission for every approved driver

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
