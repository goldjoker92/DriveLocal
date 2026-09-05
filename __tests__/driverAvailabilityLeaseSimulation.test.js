// Deterministic timeline simulation of an available driver, from the native GPS
// task down to backend candidate selection. It reproduces the production
// incident where three online moto drivers were all rejected with
// rejectedStaleWorkSession, and locks the margin between the client idle
// heartbeat and the 7 min server work-session lease.
//
// No device, emulator or network: the real client policy and the real backend
// selector are wired together around an injected clock.

import { shouldPublishDriverLocation } from '../src/utils/driverLocationPolicy';

const {
  selectEligibleDriversWithDiagnostics,
} = require('../functions/src/rides/candidates');

const SESSION_ID = 'session_abcdef0123456789';
const NATIVE_INTERVAL_MS = 60_000; // ONLINE_NATIVE_INTERVAL_MS in driverLocationTracking.js
const START_MS = 1_800_000_000_000;
const PICKUP = { lat: -4.0996, lng: -38.4952 };
const DRIVER_POSITION = { lat: -4.0998, lng: -38.4955 }; // stationary, ~35 m away

function baseDriver() {
  return {
    verificationStatus: 'approved',
    isBlocked: false,
    serviceAreaId: 'HORIZONTE_CE_BR',
    vehicleType: 'moto',
    availabilityStatus: 'online',
    availabilitySessionId: SESSION_ID,
    subscriptionActive: true,
    subscriptionExpiresAt: START_MS + 30 * 24 * 60 * 60 * 1000,
    activeRideId: null,
  };
}

// Mirrors driverLocationUpdate() in src/services/driverLocationTracking.js.
function applyPublishedPoint(driver, atMs) {
  return {
    ...driver,
    location: { ...DRIVER_POSITION },
    locationUpdatedAtMs: atMs,
    locationAvailabilitySessionId: SESSION_ID,
    availabilityUpdatedAtMs: atMs,
  };
}

function isDispatchable(driver, atMs) {
  const { eligible, diagnostics } = selectEligibleDriversWithDiagnostics(
    [{ id: 'driver_1', data: driver }],
    { pickup: PICKUP, searchRadiusMeters: 50_000, clock: { now: () => atMs } }
  );
  return { dispatchable: eligible.length === 1, diagnostics };
}

/**
 * Runs the driver online for `durationMs`, delivering one native point every
 * minute except during `outage`, and records every minute where the backend
 * would have refused to dispatch the driver.
 */
function simulate({ durationMs, outage = null }) {
  let driver = applyPublishedPoint(baseDriver(), START_MS); // first forced publish on go-online
  let lastPublish = {
    availabilitySessionId: SESSION_ID,
    atMs: START_MS,
    location: { ...DRIVER_POSITION },
  };
  const undispatchableAtMs = [];
  let worstLeaseAgeMs = 0;

  for (let t = START_MS + NATIVE_INTERVAL_MS; t <= START_MS + durationMs; t += NATIVE_INTERVAL_MS) {
    const nativePointDelivered = !outage || t < outage.fromMs || t > outage.toMs;

    if (nativePointDelivered) {
      const decision = shouldPublishDriverLocation({
        session: { availabilitySessionId: SESSION_ID, rideId: null },
        payload: { location: { ...DRIVER_POSITION }, speedMps: 0 },
        lastPublish,
        nowMs: t,
      });
      if (decision.publish) {
        driver = applyPublishedPoint(driver, t);
        lastPublish = {
          availabilitySessionId: SESSION_ID,
          atMs: t,
          location: { ...DRIVER_POSITION },
        };
      }
    }

    worstLeaseAgeMs = Math.max(worstLeaseAgeMs, t - driver.availabilityUpdatedAtMs);
    if (!isDispatchable(driver, t).dispatchable) undispatchableAtMs.push(t - START_MS);
  }

  return { undispatchableAtMs, worstLeaseAgeMs, driver };
}

describe('available driver stays dispatchable (work-session lease simulation)', () => {
  it('keeps a stationary online driver dispatchable for a full hour', () => {
    const { undispatchableAtMs, worstLeaseAgeMs } = simulate({ durationMs: 60 * 60_000 });

    expect(undispatchableAtMs).toEqual([]);
    // Well under the 7 min (420_000 ms) server lease at every single minute.
    expect(worstLeaseAgeMs).toBeLessThan(240_000);
  });

  it('survives a five-minute native delivery outage without losing the lease', () => {
    // Android doze / OEM throttling suppressing background points for 5 minutes.
    const { undispatchableAtMs } = simulate({
      durationMs: 30 * 60_000,
      outage: { fromMs: START_MS + 200_000, toMs: START_MS + 500_000 },
    });

    // With the previous 4 min idle heartbeat the last publish stayed at t=0, so
    // the lease expired at t=420 s and the driver silently stopped receiving rides.
    expect(undispatchableAtMs).toEqual([]);
  });

  it('still refuses a genuinely stale driver, so ghost dispatch stays impossible', () => {
    const { undispatchableAtMs, driver } = simulate({
      durationMs: 30 * 60_000,
      outage: { fromMs: START_MS + 200_000, toMs: START_MS + 900_000 },
    });

    expect(undispatchableAtMs.length).toBeGreaterThan(0);
    // The driver flag is still "online" while the server refuses him: this is the
    // ghost-online state observed in production.
    expect(driver.availabilityStatus).toBe('online');

    const staleMs = START_MS + 800_000;
    const { dispatchable, diagnostics } = isDispatchable(
      applyPublishedPoint(baseDriver(), START_MS + 180_000),
      staleMs
    );
    expect(dispatchable).toBe(false);
    expect(diagnostics.candidateCount).toBe(1);
    expect(diagnostics.rejectedStaleWorkSession).toBe(1);
  });
});
