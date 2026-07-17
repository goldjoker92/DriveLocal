import { normalizeTrackingPoint } from './rideTracking';

export const DEV_SIMULATION_MIN_STEPS = 6;
export const DEV_SIMULATION_MAX_STEPS = 80;
export const DEV_SIMULATION_DEFAULT_STEPS = 24;
export const DEV_SIMULATION_INTERVAL_MS = 1_500;

function clampSteps(value) {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : DEV_SIMULATION_DEFAULT_STEPS;
  return Math.max(DEV_SIMULATION_MIN_STEPS, Math.min(DEV_SIMULATION_MAX_STEPS, numeric));
}

// Generates an in-memory curved interpolation. It is intentionally NOT persisted
// as route history: Firestore still receives one current point only.
export function buildDevSimulationRoute(startValue, targetValue, requestedSteps = DEV_SIMULATION_DEFAULT_STEPS) {
  const start = normalizeTrackingPoint(startValue);
  const target = normalizeTrackingPoint(targetValue);
  if (!start || !target) return [];

  const steps = clampSteps(requestedSteps);
  const deltaLat = target.lat - start.lat;
  const deltaLng = target.lng - start.lng;
  const distance = Math.sqrt((deltaLat ** 2) + (deltaLng ** 2));
  const curveAmplitude = Math.min(distance * 0.08, 0.00035);
  const perpendicularLat = distance > 0 ? deltaLng / distance : 0;
  const perpendicularLng = distance > 0 ? -deltaLat / distance : 0;

  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    const curve = Math.sin(Math.PI * progress) * curveAmplitude;
    return {
      lat: start.lat + (deltaLat * progress) + (perpendicularLat * curve),
      lng: start.lng + (deltaLng * progress) + (perpendicularLng * curve),
    };
  });
}

// When no live point exists yet, start roughly 900 m from the target. This keeps
// the visual test inside the same local area without depending on a real vehicle.
export function createFallbackSimulationStart(targetValue, direction = 1) {
  const target = normalizeTrackingPoint(targetValue);
  if (!target) return null;
  const sign = direction < 0 ? -1 : 1;
  return {
    lat: target.lat - (0.0065 * sign),
    lng: target.lng - (0.0055 * sign),
  };
}

export function devSimulationProgress(stepIndex, stepCount) {
  const total = Math.max(1, Number(stepCount) || 1);
  const current = Math.max(0, Math.min(total, Number(stepIndex) || 0));
  return Math.round((current / total) * 100);
}
