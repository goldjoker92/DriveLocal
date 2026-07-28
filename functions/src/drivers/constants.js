// @ts-check
// Fixed server-owned constants for the secure driver domain. All money is in
// integer centavos; all durations are exact epoch-ms. These are backend
// authoritative — the client never supplies plan prices or founder positions.

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = Object.freeze({
  DRIVERS: 'drivers',
  COUNTERS: 'counters',

  DAY_MS,

  // Launch policy measured from the immutable admin approval timestamp.
  FOUNDER_LIMIT: 100, // first 100 approved drivers per service area
  FREE_PERIOD_DAYS: 60, // 0% commission for all; free subscription for founders

  // Drivers #101+ may use at most five subscription-free completed rides, and
  // only while the same 60-day launch window is active. Day 60 always wins.
  FREE_RIDE_LIMIT: 5,

  // Paid subscription plan (fixed server-side; never accepted from client).
  SUBSCRIPTION_DURATION_DAYS: 30,
  MOTO_SUBSCRIPTION_CENTAVOS: 990, // R$9,90
  CAR_SUBSCRIPTION_CENTAVOS: 1990, // R$19,90

  VEHICLE_TYPES: Object.freeze(['moto', 'car']),
});