// @ts-check
// Server-authoritative cancellation vocabulary and timing policy.
// Clients send stable codes only; labels stay in the app so free text never enters
// financial records, fraud signals or operational logs.

const DRIVER_CANCELLATION_REASONS = Object.freeze([
  'passenger_no_show',
  'pickup_address_incorrect',
  'unsafe_pickup',
  'vehicle_problem',
  'driver_other',
]);

const PASSENGER_CANCELLATION_REASONS = Object.freeze([
  'no_longer_needed',
  'driver_delayed',
  'driver_not_moving',
  'driver_or_vehicle_mismatch',
  'passenger_safety_concern',
  'passenger_other',
]);

// Pilot rule: after announcing arrival, the driver waits three complete minutes
// before the server accepts PASSENGER_NO_SHOW. No fee is charged in V1.
const PASSENGER_NO_SHOW_WAIT_MS = 3 * 60 * 1000;
const CANCELLATION_FEE_POLICY_VERSION = 'no-cancellation-fee-v1';

function allowedReasonsForRole(role) {
  if (role === 'driver') return DRIVER_CANCELLATION_REASONS;
  if (role === 'passenger') return PASSENGER_CANCELLATION_REASONS;
  return Object.freeze([]);
}

function isAllowedCancellationReason(role, reasonCode) {
  return allowedReasonsForRole(role).includes(String(reasonCode || ''));
}

function cancellationStage(status) {
  const stages = {
    searching: 'before_assignment',
    assigned: 'driver_en_route_to_pickup',
    driver_arrived: 'driver_at_pickup',
  };
  return stages[String(status || '')] || 'unknown';
}

function nonNegativeElapsed(nowMs, fromMs) {
  const start = Number(fromMs || 0);
  if (!Number.isFinite(start) || start <= 0) return null;
  return Math.max(0, Number(nowMs) - start);
}

function cancellationTiming(ride, nowMs) {
  const arrivedAtMs = Number(ride?.driverArrivedAtMs || 0) || null;
  return {
    cancellationElapsedSinceCreatedMs: nonNegativeElapsed(nowMs, ride?.createdAtMs),
    cancellationElapsedSinceAssignedMs: nonNegativeElapsed(nowMs, ride?.acceptedAtMs),
    cancellationWaitAfterArrivalMs: nonNegativeElapsed(nowMs, arrivedAtMs),
    driverHadArrived: String(ride?.status || '') === 'driver_arrived' || arrivedAtMs != null,
    driverArrivedAtMs: arrivedAtMs,
    passengerNoShowEligibleAtMs: arrivedAtMs == null
      ? null
      : arrivedAtMs + PASSENGER_NO_SHOW_WAIT_MS,
  };
}

function passengerNoShowEligibility(ride, nowMs) {
  const timing = cancellationTiming(ride, nowMs);
  const correctPhase = String(ride?.status || '') === 'driver_arrived';
  const eligibleAtMs = timing.passengerNoShowEligibleAtMs;
  const remainingMs = eligibleAtMs == null ? PASSENGER_NO_SHOW_WAIT_MS : Math.max(0, eligibleAtMs - nowMs);
  return {
    eligible: correctPhase && eligibleAtMs != null && remainingMs === 0,
    correctPhase,
    eligibleAtMs,
    remainingMs,
    waitedMs: timing.cancellationWaitAfterArrivalMs,
  };
}

module.exports = {
  DRIVER_CANCELLATION_REASONS,
  PASSENGER_CANCELLATION_REASONS,
  PASSENGER_NO_SHOW_WAIT_MS,
  CANCELLATION_FEE_POLICY_VERSION,
  allowedReasonsForRole,
  isAllowedCancellationReason,
  cancellationStage,
  cancellationTiming,
  passengerNoShowEligibility,
};