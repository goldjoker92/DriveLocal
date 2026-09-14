const {
  MIN_SUPPORTED_DRIVER_BUILD_NUMBER,
  evaluateDriverBuildNumber,
  resolveDriverBuildPolicy,
  driverHasFreshSupportedBuild,
} = require('./appVersion');

describe('driver app version policy', () => {
  test('requires build 17 or newer', () => {
    expect(MIN_SUPPORTED_DRIVER_BUILD_NUMBER).toBe(17);
    expect(evaluateDriverBuildNumber(undefined).supported).toBe(false);
    expect(evaluateDriverBuildNumber(16).supported).toBe(false);
    expect(evaluateDriverBuildNumber('17').supported).toBe(true);
    expect(evaluateDriverBuildNumber(18).supported).toBe(true);
  });

  test('stays compatible until enforcement is explicitly activated', () => {
    expect(resolveDriverBuildPolicy({})).toEqual({
      enforced: false,
      minimumBuildNumber: 17,
    });
    expect(resolveDriverBuildPolicy({
      enforceMinimumDriverBuild: true,
      minimumDriverBuildNumber: 18,
    })).toEqual({
      enforced: true,
      minimumBuildNumber: 18,
    });
  });

  test('requires a fresh version proof bound to the same work session', () => {
    const nowMs = 1_000_000;
    const base = {
      availabilitySessionId: 'work_current_session',
      availabilityClientSessionId: 'work_current_session',
      availabilityClientBuildNumber: 17,
      availabilityClientUpdatedAtMs: nowMs - 60_000,
    };

    expect(driverHasFreshSupportedBuild(base, nowMs, 20 * 60_000)).toBe(true);
    expect(driverHasFreshSupportedBuild(
      { ...base, availabilityClientSessionId: 'work_old_session' },
      nowMs,
      20 * 60_000
    )).toBe(false);
    expect(driverHasFreshSupportedBuild(
      { ...base, availabilityClientBuildNumber: 16 },
      nowMs,
      20 * 60_000
    )).toBe(false);
    expect(driverHasFreshSupportedBuild(
      { ...base, availabilityClientUpdatedAtMs: nowMs - 21 * 60_000 },
      nowMs,
      20 * 60_000
    )).toBe(false);
  });
});
