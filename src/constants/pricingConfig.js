// DriveLocal V1 pricing configuration.
//
// SINGLE SOURCE OF TRUTH for ride prices, commission rates and the wallet
// threshold. Everything here is in INTEGER CENTAVOS (BRL cents). Never use
// floats for money — see calculatePlatformFeeCentavos in utils/ridePricing.js.
//
// Business model V1 (do NOT change without product confirmation):
//   - Passenger pays the driver directly via Pix (driver gets the full ride price).
//   - DriveLocal commission is collected SEPARATELY from the driver prepaid wallet.
//   - During the free launch period commission is 0% (see commissionFreeUntil).
//   - After the free period, commission depends on vehicle type and distance.
//
// Service area: Horizonte-CE only. Valid local rides CAN be > 10 km — distance
// only selects the price tier, it never rejects a ride (see utils/serviceArea.js).

import { VEHICLE_MOTO, VEHICLE_CAR } from './vehicleTypes';

// ---------------------------------------------------------------------------
// Ride price tiers (centavos)
// ---------------------------------------------------------------------------
// Boundary rule: the upper bound `maxKm` is INCLUSIVE.
//   - exactly 1.5 km  -> first tier
//   - exactly 3.5 km  -> second tier
//   - exactly 5 km    -> third tier
// Tiers are evaluated top to bottom: the first tier whose maxKm >= distanceKm
// wins. The last tier uses Infinity so any distance inside Horizonte is priced.
export const RIDE_PRICE_TIERS_CENTAVOS = {
  [VEHICLE_MOTO]: [
    { maxKm: 1.5, priceCentavos: 450 },
    { maxKm: 3.5, priceCentavos: 550 },
    { maxKm: 5, priceCentavos: 650 },
    { maxKm: 7, priceCentavos: 890 },
    { maxKm: 10, priceCentavos: 1090 },
    { maxKm: 15, priceCentavos: 1290 },
    { maxKm: Infinity, priceCentavos: 1590 },
  ],
  [VEHICLE_CAR]: [
    { maxKm: 1.5, priceCentavos: 790 },
    { maxKm: 3.5, priceCentavos: 990 },
    { maxKm: 5, priceCentavos: 1190 },
    { maxKm: 7, priceCentavos: 1390 },
    { maxKm: 10, priceCentavos: 1590 },
    { maxKm: 15, priceCentavos: 1890 },
    { maxKm: Infinity, priceCentavos: 2290 },
  ],
};

// ---------------------------------------------------------------------------
// Commission (basis points, applied AFTER the free launch period)
// ---------------------------------------------------------------------------
// 1 bps = 0.01%. So 1200 bps = 12%, 1500 bps = 15%, 0 bps = 0%.
export const COMMISSION_BPS = {
  MOTO_SMALL: 1200, // Moto rides <= 5 km  -> 12%
  MOTO_LONG: 0, //     Moto rides  > 5 km  -> 0%
  CAR: 1500, //        All car rides        -> 15%
  NONE: 0,
};

// Distance (km) up to which a moto ride is considered "small" for commission.
// Business rule: only small moto rides (<= 5 km) pay the 12% commission; longer
// moto rides pay 0% to keep longer local trips attractive for moto drivers.
export const MOTO_SMALL_RIDE_MAX_KM = 5;

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------
// Minimum prepaid wallet balance (centavos) a driver must keep to receive rides
// where commission may apply. Kept consistent with the existing wallet fallback
// threshold (WALLET_FALLBACK_LOW_THRESHOLD_CENTS = 300).
export const MIN_WALLET_BALANCE_CENTAVOS = 300;

// ---------------------------------------------------------------------------
// Subscription (centavos / month) — charged only AFTER the free period
// ---------------------------------------------------------------------------
export const SUBSCRIPTION_MONTHLY_CENTAVOS = {
  [VEHICLE_MOTO]: 990, //  R$ 9,90 / month
  [VEHICLE_CAR]: 1990, //  R$ 19,90 / month
};

// A paid subscription period lasts 30 days.
export const SUBSCRIPTION_PERIOD_DAYS = 30;

// Free launch windows measured from the ADMIN APPROVAL date (not signup).
export const FOUNDER_FREE_DAYS = 60; //  first 100 approved drivers
export const COMMISSION_FREE_DAYS = 60; // commission is 0% for everyone for 60 days

// Non-founder drivers may complete this many rides before an active
// subscription is required (from the 6th completed ride onward).
export const NON_FOUNDER_FREE_RIDES = 5;
