// @ts-check
// Fixed server-owned constants for the secure driver domain. All money is in
// integer centavos; all durations are exact epoch-ms. These are backend
// authoritative — the client never supplies plan prices or founder positions.

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = Object.freeze({
  DRIVERS: 'drivers',
  COUNTERS: 'counters',

  DAY_MS,

  // Founder / free-period rules (per service area).
  FOUNDER_LIMIT: 100, // first 100 approved drivers per city are founders
  FREE_PERIOD_DAYS: 60, // founder commission-free + subscription-free window

  // Non-founder onboarding grace: first rides allowed without a subscription.
  FREE_RIDE_LIMIT: 5,

  // Manual subscription plan (fixed server-side; never accepted from client).
  SUBSCRIPTION_DURATION_DAYS: 30,
  MOTO_SUBSCRIPTION_CENTAVOS: 990, // R$9,90
  CAR_SUBSCRIPTION_CENTAVOS: 1990, // R$19,90

  VEHICLE_TYPES: Object.freeze(['moto', 'car']),
});
