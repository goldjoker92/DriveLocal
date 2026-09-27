const { evaluateDriverDispatchReadiness } = require('../dispatchReadiness');
const { selectEligibleDriversWithDiagnostics } = require('../../rides/candidates');
const C = require('../../rides/constants');
const NOW = 1_800_000_000_000;
const SESSION = 'work_driver_1234567890';
const healthyDriver = (overrides = {}) => ({
  verificationStatus: 'approved', availabilityStatus: 'online',
  availabilitySessionId: SESSION, locationAvailabilitySessionId: SESSION,
  availabilityUpdatedAtMs: NOW, locationUpdatedAtMs: NOW,
  location: { lat: -4.1, lng: -38.5 }, pixKey: 'driver@example.test', pixKeyType: 'email',
  commissionFreeUntil: NOW + 86_400_000,
  ...overrides,
});

describe('actual readiness for new offers', () => {
  it('a heartbeat cannot renew an expired GPS fix', () => {
    const driver = healthyDriver({ locationUpdatedAtMs: NOW - 7 * 60_000 - 1 });
    expect(evaluateDriverDispatchReadiness(driver, { nowMs: NOW })).toMatchObject({ ready: false, reason: 'location_stale' });
    const selected = selectEligibleDriversWithDiagnostics([{ id: 'driver', data: driver }], {
      pickup: driver.location, searchRadiusMeters: 3000, clock: { now: () => NOW },
    });
    expect(selected.eligible).toHaveLength(0);
    expect(selected.diagnostics.rejectedStaleLocation).toBe(1);
  });
  it('uses the server timestamp even when the phone claims a newer position', () => {
    const driver = healthyDriver({ locationUpdatedAt: { toMillis: () => NOW - C.LOCATION_DISPATCH_MAX_AGE_MS - 1 } });
    expect(evaluateDriverDispatchReadiness(driver, { nowMs: NOW }).reason).toBe('location_stale');
  });
  it('bounds GPS tolerance without closing a recoverable session', () => {
    expect(evaluateDriverDispatchReadiness(healthyDriver({ locationUpdatedAtMs: NOW - 6 * 60_000 }), { nowMs: NOW }))
      .toMatchObject({ ready: true, delayed: true, locationFreshness: 'stale_online_fallback' });
    expect(evaluateDriverDispatchReadiness(healthyDriver({ locationUpdatedAtMs: NOW - 7 * 60_000 }), { nowMs: NOW }).ready).toBe(true);
  });
  it.each([
    [{ activeRideId: 'ride' }, 'active_ride'],
    [{ availabilityStatus: 'offline' }, 'offline'],
    [{ locationAvailabilitySessionId: 'other' }, 'session_mismatch'],
    [{ verificationStatus: 'pending_review' }, 'not_approved'],
    [{ isBlocked: true }, 'blocked'],
    [{ financialReviewRequired: true }, 'risk_restricted'],
    [{ pixKey: null }, 'pix_invalid'],
    [{ commissionFreeUntil: null, walletAvailableCentavos: 300 }, 'wallet_low'],
    [{ location: null }, 'location_missing'],
  ])('explains an unavailable driver: %j', (overrides, reason) => {
    expect(evaluateDriverDispatchReadiness(healthyDriver(overrides), { nowMs: NOW }))
      .toMatchObject({ ready: false, reason });
  });
  it('keeps all approved drivers in their free period eligible with zero wallet balance', () => {
    expect(evaluateDriverDispatchReadiness(healthyDriver({ approvalNumber: 101, walletAvailableCentavos: 0 }), { nowMs: NOW }).ready).toBe(true);
  });
  it('rejects an unsupported build only when the server policy enforces it', () => {
    expect(evaluateDriverDispatchReadiness(healthyDriver(), { nowMs: NOW }).ready).toBe(true);
    expect(evaluateDriverDispatchReadiness(healthyDriver(), {
      nowMs: NOW, driverBuildPolicy: { enforceMinimumDriverBuild: true, minimumDriverBuildNumber: 21 },
    }).reason).toBe('app_update_required');
  });
});

module.exports = { healthyDriver, NOW, SESSION };
