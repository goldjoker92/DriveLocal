// Pure adaptive GPS publication policy. It decides whether a new native point is
// useful enough to write; Firebase and Expo dependencies deliberately stay out.

export const DRIVER_LOCATION_POLICIES = Object.freeze({
  online_idle: Object.freeze({
    minGapMs: 30_000,
    maxAgeMs: 4 * 60_000,
    minDistanceMeters: 100,
  }),
  online_moving: Object.freeze({
    minGapMs: 20_000,
    maxAgeMs: 60_000,
    minDistanceMeters: 60,
  }),
  assigned: Object.freeze({
    minGapMs: 8_000,
    maxAgeMs: 15_000,
    minDistanceMeters: 25,
  }),
  driver_arrived: Object.freeze({
    minGapMs: 8_000,
    maxAgeMs: 15_000,
    minDistanceMeters: 25,
  }),
  in_progress: Object.freeze({
    minGapMs: 5_000,
    maxAgeMs: 10_000,
    minDistanceMeters: 20,
  }),
});

export function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;

  const radius = 6_371_000;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function policyMode(session, payload, lastPublish) {
  if (session?.rideId) {
    if (session.rideStatus === 'in_progress') return 'in_progress';
    if (session.rideStatus === 'driver_arrived') return 'driver_arrived';
    return 'assigned';
  }

  const speedMps = Number(payload?.speedMps);
  const movedMeters = haversineMeters(lastPublish?.location, payload?.location);
  const moving = (Number.isFinite(speedMps) && speedMps >= 1.5)
    || (Number.isFinite(movedMeters) && movedMeters >= 30);
  return moving ? 'online_moving' : 'online_idle';
}

export function shouldPublishDriverLocation({
  session,
  payload,
  lastPublish,
  nowMs = Date.now(),
  force = false,
}) {
  if (force) {
    return {
      publish: true,
      reason: 'forced',
      mode: policyMode(session, payload, lastPublish),
      elapsedMs: Infinity,
      distanceMeters: Infinity,
    };
  }

  const mode = policyMode(session, payload, lastPublish);
  const policy = DRIVER_LOCATION_POLICIES[mode];
  if (!lastPublish || lastPublish.availabilitySessionId !== session?.availabilitySessionId) {
    return { publish: true, reason: 'new_session', mode, elapsedMs: Infinity, distanceMeters: Infinity };
  }

  const elapsedMs = Math.max(0, Number(nowMs) - Number(lastPublish.atMs || 0));
  const distanceMeters = haversineMeters(lastPublish.location, payload?.location);
  if (elapsedMs < policy.minGapMs) {
    return { publish: false, reason: 'min_gap', mode, elapsedMs, distanceMeters };
  }
  if (distanceMeters >= policy.minDistanceMeters) {
    return { publish: true, reason: 'distance', mode, elapsedMs, distanceMeters };
  }
  if (elapsedMs >= policy.maxAgeMs) {
    return { publish: true, reason: 'heartbeat', mode, elapsedMs, distanceMeters };
  }
  return { publish: false, reason: 'unchanged', mode, elapsedMs, distanceMeters };
}
