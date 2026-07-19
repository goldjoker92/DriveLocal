const {
  evaluateRideEligibility,
  safeDriverView,
  toMillis,
} = require('../eligibility');

const NOW_MS = Date.UTC(2026, 6, 19, 17, 30, 0);
const clock = { now: () => NOW_MS };

function timestampLike(ms) {
  return {
    // Firestore Timestamp exposes this method. valueOf is intentionally seconds-
    // shaped to prove the backend must not use Number(timestamp).
    toMillis: () => ms,
    valueOf: () => String(ms / 1000),
  };
}

describe('driver backend eligibility timestamp normalization', () => {
  it('keeps an approved founder eligible during the Firestore free window', () => {
    const result = evaluateRideEligibility(
      {
        verificationStatus: 'approved',
        founderEligible: true,
        subscriptionFreeUntil: timestampLike(NOW_MS + 60_000),
        commissionFreeUntil: timestampLike(NOW_MS + 60_000),
      },
      clock
    );

    expect(result.canReceiveRides).toBe(true);
    expect(result.subscriptionCovered).toBe(true);
    expect(result.commissionFree).toBe(true);
  });

  it('accepts a paid subscription stored as a Firestore Timestamp', () => {
    const result = evaluateRideEligibility(
      {
        verificationStatus: 'approved',
        founderEligible: true,
        subscriptionActive: true,
        subscriptionFreeUntil: timestampLike(NOW_MS - 1),
        subscriptionExpiresAt: timestampLike(NOW_MS + 30 * 24 * 60 * 60 * 1000),
      },
      clock
    );

    expect(result.canReceiveRides).toBe(true);
    expect(result.requiresSubscription).toBe(false);
  });

  it('rejects an expired founder without a paid subscription', () => {
    const result = evaluateRideEligibility(
      {
        verificationStatus: 'approved',
        founderEligible: true,
        subscriptionFreeUntil: timestampLike(NOW_MS - 1),
        subscriptionActive: false,
      },
      clock
    );

    expect(result.canReceiveRides).toBe(false);
    expect(result.requiresSubscription).toBe(true);
  });

  it('normalizes Date, epoch milliseconds and seconds/nanoseconds shapes', () => {
    expect(toMillis(new Date(NOW_MS))).toBe(NOW_MS);
    expect(toMillis(NOW_MS)).toBe(NOW_MS);
    expect(toMillis({
      seconds: Math.floor(NOW_MS / 1000),
      nanoseconds: (NOW_MS % 1000) * 1e6,
    })).toBe(NOW_MS);
  });

  it('preserves approvalNumber in the safe client projection', () => {
    expect(safeDriverView('driver-1', { approvalNumber: 7 }).approvalNumber).toBe(7);
  });
});
