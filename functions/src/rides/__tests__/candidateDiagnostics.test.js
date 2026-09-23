const {
  selectEligibleDriversWithDiagnostics,
  ONLINE_STALE_FALLBACK_MAX_AGE_MS,
} = require('../candidates');
const C = require('../constants');

const NOW = 1_784_503_000_000;
const clock = { now: () => NOW };
const pickup = { lat: -4.1109, lng: -38.4838 };

function candidate(id, over = {}) {
  const availabilitySessionId = `work_${id}_session_123456789`;
  return {
    id,
    data: {
      availabilityStatus: 'online',
      availabilitySessionId,
      availabilityUpdatedAtMs: NOW - 60_000,
      activeRideId: null,
      location: { lat: -4.1109, lng: -38.4838 },
      locationUpdatedAtMs: NOW - 60_000,
      locationAvailabilitySessionId: availabilitySessionId,
      verificationStatus: 'approved',
      isBlocked: false,
      pixKeyType: 'E-mail',
      pixKey: `${id}@pix.test.drivelocal.local`,
      founderEligible: true,
      subscriptionFreeUntil: NOW + 24 * 60 * 60 * 1000,
      commissionFreeUntil: NOW + 24 * 60 * 60 * 1000,
      ...over,
    },
  };
}

describe('candidate diagnostics and bounded work-session fallback', () => {
  it('keeps fresh drivers first and tolerates only a short GPS delay', () => {
    const candidates = [
      candidate('fresh'),
      candidate('stale-recoverable', {
        locationUpdatedAtMs: NOW - 16 * 60 * 1000,
      }),
      candidate('stale-too-old', {
        locationUpdatedAtMs: NOW - 25 * 60 * 1000,
      }),
      candidate('work-session-too-old', {
        availabilityUpdatedAtMs: NOW - 25 * 60 * 1000,
      }),
      candidate('session-mismatch', {
        locationAvailabilitySessionId: 'work_previous_session_987654321',
      }),
      candidate('busy', { activeRideId: 'other-ride' }),
      candidate('previously-plan-blocked', {
        founderEligible: true,
        subscriptionFreeUntil: NOW - 1,
        subscriptionActive: false,
      }),
    ];

    const { eligible, diagnostics } = selectEligibleDriversWithDiagnostics(candidates, {
      pickup,
      searchRadiusMeters: C.DEFAULT_SEARCH_RADIUS_METERS,
      clock,
    });

    expect(eligible.map((item) => item.driverId)).toEqual(['fresh', 'previously-plan-blocked', 'stale-recoverable']);
    expect(eligible[0].locationFreshness).toBe('fresh');
    expect(eligible[2].locationFreshness).toBe('stale_online_fallback');
    expect(diagnostics).toMatchObject({
      candidateCount: 7,
      eligibleCount: 3,
      freshEligibleCount: 2,
      staleFallbackEligibleCount: 1,
      rejectedCount: 4,
      rejectedBusy: 1,
      rejectedMissingWorkSession: 1,
      rejectedStaleWorkSession: 1,
      rejectedStaleLocation: 1,
      searchRadiusMeters: 8_000,
      locationMaxAgeMs: 15 * 60 * 1000,
      availabilitySessionMaxAgeMs: 20 * 60 * 1000,
      staleFallbackMaxAgeMs: ONLINE_STALE_FALLBACK_MAX_AGE_MS,
    });
  });

  it('does not recover a fresh point when the work-session lease is too old', () => {
    const { eligible, diagnostics } = selectEligibleDriversWithDiagnostics([
      candidate('ghost-online', {
        locationUpdatedAtMs: NOW - 60_000,
        availabilityUpdatedAtMs: NOW - 35 * 60 * 1000,
      }),
    ], {
      pickup,
      searchRadiusMeters: 15_000,
      clock,
    });

    expect(eligible).toHaveLength(0);
    expect(diagnostics.rejectedStaleWorkSession).toBe(1);
  });

  it('excludes invalid Pix keys once the build 17 policy is enforced', () => {
    const validSession = candidate('valid-pix', {
      pixKeyType: 'CPF',
      pixKey: '529.982.247-25',
      availabilityClientBuildNumber: 17,
      availabilityClientSessionId: 'work_valid-pix_session_123456789',
      availabilityClientUpdatedAtMs: NOW - 60_000,
    });
    const invalidSession = candidate('invalid-pix', {
      pixKeyType: 'CPF',
      pixKey: '024.995.773-635',
      availabilityClientBuildNumber: 17,
      availabilityClientSessionId: 'work_invalid-pix_session_123456789',
      availabilityClientUpdatedAtMs: NOW - 60_000,
    });

    const { eligible, diagnostics } = selectEligibleDriversWithDiagnostics(
      [validSession, invalidSession],
      {
        pickup,
        searchRadiusMeters: 50_000,
        clock,
        driverBuildPolicy: {
          enforceMinimumDriverBuild: true,
          minimumDriverBuildNumber: 17,
        },
      }
    );

    expect(eligible.map((item) => item.driverId)).toEqual(['valid-pix']);
    expect(diagnostics.rejectedInvalidPixKey).toBe(1);
  });

});
