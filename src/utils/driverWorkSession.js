// Single client-side source of truth for how long a driver work session stays
// alive. This used to be duplicated in three reconcilers (root layout, driver
// layout, cockpit), each ending the shift at the 7 min dispatch lease.
//
// The two windows answer different questions:
//
//   - 7 min  → SERVER DISPATCH rule. A driver whose last published point is
//     older than this is skipped for offers. It is not a reason to end his
//     shift: a tunnel, an indoor stop or a short Android doze must not log out
//     a driver who is still working, and releasing the screen lock at that
//     exact moment makes republishing a point even less likely.
//   - 30 min → ABANDONMENT window. Mirrors WORK_SESSION_ABANDONED_MAX_AGE_MS in
//     functions/src/rides/constants.js, where dispatch closes the session. Past
//     it the app is gone (killed, swiped, battery optimization) and the client
//     must stop claiming the driver is available.
//
// Between the two the session stays open and recovers on its own.

export const WORK_SESSION_DISPATCH_LEASE_MS = 7 * 60 * 1000;
export const WORK_SESSION_ABANDONED_MAX_AGE_MS = 30 * 60 * 1000;

// Accepts a Firestore Timestamp, a {seconds,nanoseconds} shape or epoch ms.
export function workSessionUpdatedAtMs(driver) {
  const value = driver?.availabilityUpdatedAt;
  if (value) {
    if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (Number.isFinite(Number(value.seconds))) {
      return Number(value.seconds) * 1000
        + Math.floor(Number(value.nanoseconds || 0) / 1e6);
    }
    if (Number.isFinite(Number(value))) return Number(value);
  }
  const fallback = Number(driver?.availabilityUpdatedAtMs || 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

/**
 * Should the client keep the work session (and the screen lock) alive?
 * @returns {boolean}
 */
export function remoteWorkSessionRecoverable(driver, nowMs = Date.now()) {
  const updatedAtMs = workSessionUpdatedAtMs(driver);
  if (!(updatedAtMs > 0)) return false;
  const ageMs = Number(nowMs) - updatedAtMs;
  return ageMs >= 0
    ? ageMs <= WORK_SESSION_ABANDONED_MAX_AGE_MS
    // A phone clock briefly behind the server must not end a live session.
    : true;
}

/**
 * Is the driver currently eligible for offers? Informational on the client —
 * the backend remains authoritative for dispatch.
 * @returns {boolean}
 */
export function remoteWorkSessionDispatchable(driver, nowMs = Date.now()) {
  const updatedAtMs = workSessionUpdatedAtMs(driver);
  if (!(updatedAtMs > 0)) return false;
  const ageMs = Number(nowMs) - updatedAtMs;
  return ageMs <= WORK_SESSION_DISPATCH_LEASE_MS;
}
