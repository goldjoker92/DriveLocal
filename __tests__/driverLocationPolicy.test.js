const {
  shouldPublishDriverLocation,
  policyMode,
} = require('../src/utils/driverLocationPolicy');

const SESSION = {
  driverId: 'driver1',
  availabilitySessionId: 'work_session_123456789',
  rideId: null,
};

function payload(lat = -4.1, lng = -38.49, speedMps = 0) {
  return {
    location: { lat, lng },
    accuracyMeters: 10,
    headingDegrees: null,
    speedMps,
  };
}

function last(overrides = {}) {
  return {
    availabilitySessionId: SESSION.availabilitySessionId,
    atMs: 1_000_000,
    location: { lat: -4.1, lng: -38.49 },
    ...overrides,
  };
}

describe('adaptive driver location policy', () => {
  it('publishes the first point of a new work session', () => {
    const result = shouldPublishDriverLocation({
      session: SESSION,
      payload: payload(),
      lastPublish: last({ availabilitySessionId: 'old_session_123456' }),
      nowMs: 1_001_000,
    });
    expect(result).toMatchObject({ publish: true, reason: 'new_session' });
  });

  it('keeps an idle driver quiet until the four-minute heartbeat', () => {
    const beforeHeartbeat = shouldPublishDriverLocation({
      session: SESSION,
      payload: payload(),
      lastPublish: last(),
      nowMs: 1_000_000 + 3 * 60_000,
    });
    expect(beforeHeartbeat.publish).toBe(false);

    const heartbeat = shouldPublishDriverLocation({
      session: SESSION,
      payload: payload(),
      lastPublish: last(),
      nowMs: 1_000_000 + 4 * 60_000,
    });
    expect(heartbeat).toMatchObject({ publish: true, reason: 'heartbeat', mode: 'online_idle' });
  });

  it('publishes meaningful movement without waiting for the heartbeat', () => {
    const result = shouldPublishDriverLocation({
      session: SESSION,
      payload: payload(-4.0992, -38.49, 5),
      lastPublish: last(),
      nowMs: 1_070_000,
    });
    expect(result.publish).toBe(true);
    expect(result.reason).toBe('distance');
    expect(result.mode).toBe('online_moving');
  });

  it('throttles active-ride points inside the minimum gap', () => {
    const session = { ...SESSION, rideId: 'ride1', rideStatus: 'in_progress' };
    const result = shouldPublishDriverLocation({
      session,
      payload: payload(-4.0998, -38.49, 8),
      lastPublish: last({ atMs: 2_000_000 }),
      nowMs: 2_004_000,
    });
    expect(result).toMatchObject({ publish: false, reason: 'min_gap', mode: 'in_progress' });
  });

  it('uses a tighter heartbeat once the ride is in progress', () => {
    const session = { ...SESSION, rideId: 'ride1', rideStatus: 'in_progress' };
    const result = shouldPublishDriverLocation({
      session,
      payload: payload(),
      lastPublish: last({ atMs: 3_000_000 }),
      nowMs: 3_010_000,
    });
    expect(result).toMatchObject({ publish: true, reason: 'heartbeat', mode: 'in_progress' });
  });

  it('distinguishes assigned rides from in-progress rides', () => {
    expect(policyMode({ ...SESSION, rideId: 'ride1', rideStatus: 'assigned' }, payload(), null))
      .toBe('assigned');
    expect(policyMode({ ...SESSION, rideId: 'ride1', rideStatus: 'in_progress' }, payload(), null))
      .toBe('in_progress');
  });
});
