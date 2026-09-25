// @ts-check
// Fixed server-owned constants for the secure driver domain. All money is in
// integer centavos; all durations are exact epoch-ms. These are backend
// authoritative — the client never supplies commission rates or founder positions.

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = Object.freeze({
  DRIVERS: 'drivers',
  COUNTERS: 'counters',

  DAY_MS,

  // Launch policy measured from the immutable admin approval timestamp.
  FOUNDER_LIMIT: 100, // first 100 approved drivers across the platform
  // Reuse the existing Horizonte counter so this release cannot renumber the
  // pilot's already approved founders when the global rule takes effect.
  FOUNDER_COUNTER_ID: 'HORIZONTE_CE_BR',
  FREE_PERIOD_DAYS: 60, // 0% commission for every approved driver

  VEHICLE_TYPES: Object.freeze(['moto', 'car']),
});
