// @ts-check
// Time and determinism helpers.
//
// Business/application logic must receive a clock explicitly so tests are
// deterministic — no hidden Date.now() in testable code. systemClock is the only
// sanctioned place that reads the real wall clock.

const admin = require('firebase-admin');

// Real clock (production/runtime).
const systemClock = Object.freeze({ now: () => Date.now() });

/**
 * Deterministic clock for tests. now() returns the fixed ms; advance() moves it.
 * @param {number} fixedMs
 */
function fixedClock(fixedMs) {
  let current = Number(fixedMs) || 0;
  return {
    now: () => current,
    advance: (deltaMs) => {
      current += Number(deltaMs) || 0;
      return current;
    },
  };
}

// Firestore server timestamp sentinel (authoritative write time). Does not read
// the local clock and does not require initializeApp() to be constructed.
function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

// Non-negative duration between two epoch-ms values.
function durationMs(startMs, endMs) {
  const d = (Number(endMs) || 0) - (Number(startMs) || 0);
  return d > 0 ? d : 0;
}

module.exports = { systemClock, fixedClock, serverTimestamp, durationMs };
