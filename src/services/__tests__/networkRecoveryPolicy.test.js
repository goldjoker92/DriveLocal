const {
  classifyNetworkError,
  isConnectivityError,
  isTerminalRideStatus,
  rideRecoveryRoute,
  sanitizeRideRecoveryHint,
  shouldRestoreFromRoute,
  stableLocalOwnerHash,
} = require('../networkRecoveryPolicy');

describe('network recovery policy', () => {
  it('separates connectivity, timeout, auth and business errors', () => {
    expect(classifyNetworkError({ code: 'functions/unavailable' })).toBe('offline');
    expect(classifyNetworkError({ code: 'functions/deadline-exceeded' })).toBe('timeout');
    expect(classifyNetworkError({ code: 'functions/unauthenticated' })).toBe('auth');
    expect(classifyNetworkError({ code: 'functions/failed-precondition' })).toBe('business');
    expect(isConnectivityError({ code: 'auth/network-request-failed' })).toBe(true);
    expect(isConnectivityError({ code: 'functions/invalid-argument' })).toBe(false);
  });

  it('stores only a bounded non-terminal ride hint', () => {
    const nowMs = 2_000_000;
    const ownerHash = stableLocalOwnerHash('PRIVATE_UID');
    const hint = sanitizeRideRecoveryHint({
      ownerHash,
      role: 'passenger',
      rideId: 'ride_123',
      status: 'assigned',
      recordedAtMs: nowMs - 1000,
    }, nowMs);
    expect(hint).toMatchObject({
      role: 'passenger',
      rideId: 'ride_123',
      status: 'assigned',
      ownerHash,
    });
    expect(JSON.stringify(hint)).not.toContain('PRIVATE_UID');
    expect(sanitizeRideRecoveryHint({ ...hint, status: 'completed' }, nowMs)).toBeNull();
    expect(sanitizeRideRecoveryHint({ ...hint, recordedAtMs: 1 }, nowMs + 25 * 60 * 60 * 1000)).toBeNull();
  });

  it('restores through the authoritative role-specific router', () => {
    expect(rideRecoveryRoute({ role: 'driver', rideId: 'ride-1' })).toEqual({
      pathname: '/active-ride',
      params: { rideId: 'ride-1', restored: '1' },
    });
    expect(rideRecoveryRoute({ role: 'passenger', rideId: 'ride-2' })).toEqual({
      pathname: '/searching',
      params: { rideId: 'ride-2', restored: '1' },
    });
    expect(isTerminalRideStatus('cancelled')).toBe(true);
    expect(isTerminalRideStatus('in_progress')).toBe(false);
  });

  it('auto-restores only from navigation roots, never over a sensitive workflow', () => {
    expect(shouldRestoreFromRoute('/driver-home')).toBe(true);
    expect(shouldRestoreFromRoute('/passenger-home')).toBe(true);
    expect(shouldRestoreFromRoute('/privacy-center')).toBe(false);
    expect(shouldRestoreFromRoute('/support-center')).toBe(false);
    expect(shouldRestoreFromRoute('/admin-alerts')).toBe(false);
  });
});
