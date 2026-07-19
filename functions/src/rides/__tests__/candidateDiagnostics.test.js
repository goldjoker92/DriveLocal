const {
  selectEligibleDriversWithDiagnostics,
  ONLINE_STALE_FALLBACK_MAX_AGE_MS,
} = require('../candidates');
const C = require('../constants');

const NOW = 1_784_503_000_000;
const clock = { now: () => NOW };
const pickup = { lat: -4.1109, lng: -38.4838 };

function candidate(id, over = {}) {
  return {
    id,
    data: {
      availabilityStatus: 'online',
      availabilityUpdatedAt: NOW - 60_000,
      activeRideId: null,
      location: { lat: -4.1109, lng: -38.4838 },
      locationUpdatedAtMs: NOW - 60_000,
      verificationStatus: 'approved',
      isBlocked: false,
      founderEligible: true,
      subscriptionFreeUntil: NOW + 24 * 60 * 60 * 1000,
      commissionFreeUntil: NOW + 24 * 60 * 60 * 1000,
      ...over,
    },
  };
}

describe('candidate diagnostics and Horizonte stale-online fallback', () => {
  it('keeps fresh drivers first and recovers a recently-online stale heartbeat', () => {
    const candidates = [
      candidate('fresh'),
      candidate('stale-recoverable', {
        locationUpdatedAtMs: NOW - 35 * 60 * 1000,
        availabilityUpdatedAt: NOW - 35 * 60 * 1000,
      }),
      candidate('stale-too-old', {
        locationUpdatedAtMs: NOW - 2 * 60 * 60 * 1000,
        availabilityUpdatedAt: NOW - 2 * 60 * 60 * 1000,
      }),
      candidate('busy', { activeRideId: 'other-ride' }),
      candidate('subscription-required', {
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

    expect(eligible.map((item) => item.driverId)).toEqual(['fresh', 'stale-recoverable']);
    expect(eligible[0].locationFreshness).toBe('fresh');
    expect(eligible[1].locationFreshness).toBe('stale_online_fallback');
    expect(diagnostics).toMatchObject({
      candidateCount: 5,
      eligibleCount: 2,
      freshEligibleCount: 1,
      staleFallbackEligibleCount: 1,
      rejectedCount: 3,
      rejectedBusy: 1,
      rejectedStaleLocation: 1,
      rejectedSubscriptionRequired: 1,
      searchRadiusMeters: 50_000,
      locationMaxAgeMs: 5 * 60 * 1000,
      staleFallbackMaxAgeMs: ONLINE_STALE_FALLBACK_MAX_AGE_MS,
    });
  });

  it('does not recover a stale location when the online status is also too old', () => {
    const { eligible, diagnostics } = selectEligibleDriversWithDiagnostics([
      candidate('ghost-online', {
        locationUpdatedAtMs: NOW - 20 * 60 * 1000,
        availabilityUpdatedAt: NOW - 2 * 60 * 60 * 1000,
      }),
    ], {
      pickup,
      searchRadiusMeters: 50_000,
      clock,
    });

    expect(eligible).toHaveLength(0);
    expect(diagnostics.rejectedStaleLocation).toBe(1);
  });
});
