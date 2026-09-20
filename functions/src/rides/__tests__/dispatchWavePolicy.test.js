const C = require('../constants');
const {
  assertWavePlan,
  waveAt,
  dueWaveIndex,
  nextWaveIndex,
  remainingSearchMs,
  offerTtlSeconds,
} = require('../dispatchWavePolicy');

describe('progressive dispatch wave policy', () => {
  it('locks the agreed 3/6/10/12/15 km cadence inside one 90-second search', () => {
    expect(assertWavePlan()).toBe(true);
    expect(C.DISPATCH_WAVES).toEqual([
      { index: 0, offsetMs: 0, radiusMeters: 3_000 },
      { index: 1, offsetMs: 15_000, radiusMeters: 6_000 },
      { index: 2, offsetMs: 30_000, radiusMeters: 10_000 },
      { index: 3, offsetMs: 45_000, radiusMeters: 12_000 },
      { index: 4, offsetMs: 60_000, radiusMeters: 15_000 },
    ]);
    expect(C.OFFER_TTL_SECONDS).toBe(60);
    expect(C.SEARCH_TTL_SECONDS).toBe(90);
    expect(C.DEFAULT_SEARCH_RADIUS_METERS).toBe(15_000);
  });

  it('resolves due/next waves deterministically at every boundary', () => {
    const createdAtMs = 1_000_000;
    expect(dueWaveIndex(createdAtMs, createdAtMs)).toBe(0);
    expect(dueWaveIndex(createdAtMs, createdAtMs + 14_999)).toBe(0);
    expect(dueWaveIndex(createdAtMs, createdAtMs + 15_000)).toBe(1);
    expect(dueWaveIndex(createdAtMs, createdAtMs + 44_999)).toBe(2);
    expect(dueWaveIndex(createdAtMs, createdAtMs + 60_000)).toBe(4);
    expect(nextWaveIndex(3)).toBe(4);
    expect(nextWaveIndex(4)).toBeNull();
    expect(waveAt(99)).toBeNull();
  });

  it('clips a driver offer to the remaining global search time', () => {
    const nowMs = 2_000_000;
    expect(offerTtlSeconds(nowMs + 90_000, nowMs)).toBe(60);
    expect(offerTtlSeconds(nowMs + 21_001, nowMs)).toBe(22);
    expect(offerTtlSeconds(nowMs + 1, nowMs)).toBe(1);
    expect(offerTtlSeconds(nowMs, nowMs)).toBe(0);
    expect(remainingSearchMs(nowMs + 10_000, nowMs)).toBe(10_000);
  });
});
