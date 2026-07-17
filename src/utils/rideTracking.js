export const ACTIVE_TRACKING_RIDE_STATUSES = new Set([
  'assigned',
  'driver_arrived',
  'in_progress',
]);

export const DEFAULT_TRACKING_STALE_MS = 30_000;

export function isValidTrackingPoint(point) {
  const lat = Number(point?.lat ?? point?.latitude);
  const lng = Number(point?.lng ?? point?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
}

export function normalizeTrackingPoint(point) {
  if (!isValidTrackingPoint(point)) return null;
  return {
    lat: Number(point?.lat ?? point?.latitude),
    lng: Number(point?.lng ?? point?.longitude),
  };
}

export function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

export function isTrackingLocationFresh(location, nowMs = Date.now(), maxAgeMs = DEFAULT_TRACKING_STALE_MS) {
  const updatedAtMs = timestampToMillis(location?.updatedAt) || Number(location?.updatedAtMs || 0);
  return updatedAtMs > 0 && nowMs - updatedAtMs >= 0 && nowMs - updatedAtMs <= maxAgeMs;
}

export function shouldPublishRideLocation(status) {
  return ACTIVE_TRACKING_RIDE_STATUSES.has(status);
}

function optionalNonNegativeNumber(value) {
  // Native GPS fields may be null when Android has no accuracy, heading or
  // speed estimate. Number(null) is 0, which would invent telemetry.
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function safeTrackingPayload(locationObject) {
  const point = normalizeTrackingPoint(locationObject?.coords);
  if (!point) return null;

  const accuracy = optionalNonNegativeNumber(locationObject?.coords?.accuracy);
  const heading = optionalNonNegativeNumber(locationObject?.coords?.heading);
  const speed = optionalNonNegativeNumber(locationObject?.coords?.speed);

  return {
    location: point,
    accuracyMeters: accuracy == null ? null : Math.round(accuracy),
    headingDegrees: heading == null ? null : Math.round(heading),
    speedMps: speed == null ? null : Number(speed.toFixed(2)),
  };
}
