'use strict';

// Pure, server-owned performance counters for the driver cockpit. These counters
// live separately from the daily/weekly revenue aggregate so concurrent Firestore
// triggers cannot overwrite one another. Every trigger applies a deterministic
// marker on its source document before incrementing these values.

const DRIVER_PERFORMANCE_STATS_VERSION = 'driver-performance-stats-v1';

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function normalizedStats(previous = {}, nowMs = Date.now()) {
  const prior = previous && typeof previous === 'object' ? previous : {};
  return {
    version: DRIVER_PERFORMANCE_STATS_VERSION,
    offersReceivedCount: nonNegativeInteger(prior.offersReceivedCount),
    offersAcceptedCount: nonNegativeInteger(prior.offersAcceptedCount),
    terminalRideCount: nonNegativeInteger(prior.terminalRideCount),
    completedRideCount: nonNegativeInteger(prior.completedRideCount),
    cancelledRideCount: nonNegativeInteger(prior.cancelledRideCount),
    trackingStartedAtMs: nonNegativeInteger(prior.trackingStartedAtMs) || nonNegativeInteger(nowMs),
    updatedAtMs: nonNegativeInteger(nowMs),
  };
}

function nextOfferReceivedStats(previous, nowMs) {
  const next = normalizedStats(previous, nowMs);
  next.offersReceivedCount += 1;
  return Object.freeze(next);
}

function nextOfferAcceptedStats(previous, nowMs) {
  const next = normalizedStats(previous, nowMs);
  next.offersAcceptedCount += 1;
  // Defensive invariant for out-of-order trigger delivery: accepted can never be
  // greater than received in the public rate shown to the driver.
  next.offersReceivedCount = Math.max(next.offersReceivedCount, next.offersAcceptedCount);
  return Object.freeze(next);
}

function nextTerminalRideStats(previous, terminalStatus, nowMs) {
  const next = normalizedStats(previous, nowMs);
  next.terminalRideCount += 1;
  if (terminalStatus === 'completed') next.completedRideCount += 1;
  else if (terminalStatus === 'cancelled') next.cancelledRideCount += 1;
  return Object.freeze(next);
}

function rateBps(numerator, denominator) {
  const safeNumerator = nonNegativeInteger(numerator);
  const safeDenominator = nonNegativeInteger(denominator);
  if (safeDenominator <= 0) return null;
  return Math.max(0, Math.min(10000, Math.round((safeNumerator * 10000) / safeDenominator)));
}

module.exports = {
  DRIVER_PERFORMANCE_STATS_VERSION,
  nonNegativeInteger,
  normalizedStats,
  nextOfferReceivedStats,
  nextOfferAcceptedStats,
  nextTerminalRideStats,
  rateBps,
};
