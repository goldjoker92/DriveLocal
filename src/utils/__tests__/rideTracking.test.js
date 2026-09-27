import {
  ACTIVE_TRACKING_RIDE_STATUSES,
  isTrackingLocationFresh,
  isRecentNativeLocationSample,
  isValidTrackingPoint,
  normalizeTrackingPoint,
  safeTrackingPayload,
  shouldPublishRideLocation,
  timestampToMillis,
} from '../rideTracking';

describe('ride live tracking helpers', () => {
  it('does not publish delayed native callbacks as fresh locations', () => {
    const now = 1_800_000_000_000;
    expect(isRecentNativeLocationSample({ timestamp: now - 30_000 }, now)).toBe(true);
    expect(isRecentNativeLocationSample({ timestamp: now - 10 * 60_000 }, now)).toBe(false);
    expect(isRecentNativeLocationSample({ timestamp: now + 60_000 }, now)).toBe(false);
    expect(isRecentNativeLocationSample({}, now)).toBe(false);
  });
  it('accepts valid lat/lng and latitude/longitude shapes', () => {
    expect(isValidTrackingPoint({ lat: -4.1, lng: -38.5 })).toBe(true);
    expect(isValidTrackingPoint({ latitude: -4.1, longitude: -38.5 })).toBe(true);
  });

  it('rejects malformed or out-of-range points', () => {
    expect(isValidTrackingPoint(null)).toBe(false);
    expect(isValidTrackingPoint({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidTrackingPoint({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidTrackingPoint({ lat: 'x', lng: -38.5 })).toBe(false);
  });

  it('normalizes coordinates without extra fields', () => {
    expect(normalizeTrackingPoint({ latitude: -4.1, longitude: -38.5, label: 'secret' }))
      .toEqual({ lat: -4.1, lng: -38.5 });
  });

  it('publishes only moving ride statuses', () => {
    expect([...ACTIVE_TRACKING_RIDE_STATUSES]).toEqual(['assigned', 'driver_arrived', 'in_progress']);
    expect(shouldPublishRideLocation('assigned')).toBe(true);
    expect(shouldPublishRideLocation('in_progress')).toBe(true);
    expect(shouldPublishRideLocation('awaiting_payment')).toBe(false);
    expect(shouldPublishRideLocation('completed')).toBe(false);
  });

  it('normalizes a native location payload and rounds telemetry', () => {
    expect(safeTrackingPayload({
      coords: {
        latitude: -4.0995358,
        longitude: -38.5006227,
        accuracy: 8.7,
        heading: 182.4,
        speed: 7.126,
      },
    })).toEqual({
      location: { lat: -4.0995358, lng: -38.5006227 },
      accuracyMeters: 9,
      headingDegrees: 182,
      speedMps: 7.13,
    });
  });

  it('removes unavailable native telemetry instead of inventing values', () => {
    expect(safeTrackingPayload({
      coords: { latitude: -4.1, longitude: -38.5, accuracy: null, heading: -1, speed: -1 },
    })).toEqual({
      location: { lat: -4.1, lng: -38.5 },
      accuracyMeters: null,
      headingDegrees: null,
      speedMps: null,
    });
  });

  it('supports Firestore timestamps, Date and epoch milliseconds', () => {
    expect(timestampToMillis({ toMillis: () => 1000 })).toBe(1000);
    expect(timestampToMillis(new Date(2000))).toBe(2000);
    expect(timestampToMillis(3000)).toBe(3000);
  });

  it('marks recent positions fresh and old positions stale', () => {
    expect(isTrackingLocationFresh({ updatedAtMs: 90_000 }, 100_000, 30_000)).toBe(true);
    expect(isTrackingLocationFresh({ updatedAtMs: 60_000 }, 100_000, 30_000)).toBe(false);
    expect(isTrackingLocationFresh(null, 100_000, 30_000)).toBe(false);
  });

  it('rejects future timestamps as not fresh', () => {
    expect(isTrackingLocationFresh({ updatedAtMs: 101_000 }, 100_000, 30_000)).toBe(false);
  });
});
