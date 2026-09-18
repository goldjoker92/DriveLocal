// @ts-check
// Pure progressive-dispatch policy. Keeping time/radius decisions here makes the
// production task, scheduled fallback and deterministic tests share one contract.

const C = require('./constants');

function assertWavePlan(waves = C.DISPATCH_WAVES) {
  if (!Array.isArray(waves) || waves.length === 0) {
    throw new Error('dispatch wave plan must not be empty');
  }

  let previousOffset = -1;
  let previousRadius = 0;
  waves.forEach((wave, position) => {
    if (wave.index !== position) throw new Error('dispatch wave indexes must be contiguous');
    if (!Number.isFinite(wave.offsetMs) || wave.offsetMs < 0 || wave.offsetMs <= previousOffset) {
      if (!(position === 0 && wave.offsetMs === 0)) {
        throw new Error('dispatch wave offsets must be strictly increasing');
      }
    }
    if (!Number.isFinite(wave.radiusMeters) || wave.radiusMeters <= previousRadius) {
      throw new Error('dispatch wave radii must be strictly increasing');
    }
    previousOffset = wave.offsetMs;
    previousRadius = wave.radiusMeters;
  });

  if (waves[0].offsetMs !== 0) throw new Error('first dispatch wave must start at zero');
  if (waves[waves.length - 1].radiusMeters > C.DEFAULT_SEARCH_RADIUS_METERS) {
    throw new Error('dispatch wave exceeds configured maximum radius');
  }
  if (waves[waves.length - 1].offsetMs >= C.SEARCH_TTL_SECONDS * 1000) {
    throw new Error('last dispatch wave must start before the global search deadline');
  }
  return true;
}

function waveAt(index) {
  const parsed = Number(index);
  return Number.isInteger(parsed) && parsed >= 0
    ? C.DISPATCH_WAVES[parsed] || null
    : null;
}

function lastWaveIndex() {
  return C.DISPATCH_WAVES.length - 1;
}

function dueWaveIndex(createdAtMs, nowMs) {
  const elapsedMs = Math.max(0, Number(nowMs) - Number(createdAtMs || 0));
  let due = 0;
  for (const wave of C.DISPATCH_WAVES) {
    if (wave.offsetMs <= elapsedMs) due = wave.index;
    else break;
  }
  return due;
}

function nextWaveIndex(currentIndex) {
  const parsed = Number(currentIndex);
  const next = Number.isInteger(parsed) ? parsed + 1 : 0;
  return waveAt(next) ? next : null;
}

function remainingSearchMs(searchExpiresAtMs, nowMs) {
  return Math.max(0, Number(searchExpiresAtMs || 0) - Number(nowMs));
}

function offerTtlSeconds(searchExpiresAtMs, nowMs) {
  const remainingMs = remainingSearchMs(searchExpiresAtMs, nowMs);
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.min(
    C.OFFER_TTL_SECONDS,
    Math.ceil(remainingMs / 1000)
  ));
}

assertWavePlan();

module.exports = {
  assertWavePlan,
  waveAt,
  lastWaveIndex,
  dueWaveIndex,
  nextWaveIndex,
  remainingSearchMs,
  offerTtlSeconds,
};
