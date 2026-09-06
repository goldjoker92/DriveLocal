// Single client-side source of truth for how long a driver work session stays
// alive. This used to be duplicated in three reconcilers (root layout, driver
// layout, cockpit), each ending the shift at the 7 min dispatch lease.
//
// The two windows answer different questions:
//
//   - 20 min → SERVER DISPATCH rule. Mirrors AVAILABILITY_SESSION_MAX_AGE_MS in
//     functions/src/rides/constants.js. A driver whose session is older than
//     this is skipped for offers. It is not a reason to end his shift: a
//     tunnel, an indoor stop or a short Android doze must not log out a driver
//     who is still working, and releasing the screen lock at that exact moment
//     makes republishing a point even less likely.
//   - 45 min → ABANDONMENT window. Mirrors WORK_SESSION_ABANDONED_MAX_AGE_MS,
//     where dispatch closes the session. Past it the app is gone (killed,
//     swiped, battery optimization) and the client must stop claiming the
//     driver is available.
//
// Between the two the session stays open and recovers on its own.
//
// These MUST stay equal to their server counterparts. A client window shorter
// than the server's makes the app end a shift the backend still considers live,
// which is exactly the "my app said disponível but I got nothing" report.

export const WORK_SESSION_DISPATCH_LEASE_MS = 20 * 60 * 1000;
export const WORK_SESSION_ABANDONED_MAX_AGE_MS = 45 * 60 * 1000;

// The driver stops being offered rides well before his shift is at risk. This
// is the point where the app must SAY so instead of showing "disponível":
// silence plus a reassuring label is what makes a working driver give up.
export const DISPATCH_VISIBILITY_WARNING_MS = 3 * 60 * 1000;

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

/**
 * What the driver must be told about his own visibility to dispatch.
 *
 *   healthy  → nothing is shown.
 *   delayed  → his session is ageing; still dispatchable, but the app warns
 *              early because recovery is free while the session is alive.
 *   invisible→ the backend is no longer offering him rides. Saying nothing here
 *              is what loses drivers: he waits, gets nothing, and concludes the
 *              platform has no rides.
 *
 * Pure: the caller owns the clock and the rendering.
 *
 * @param {object|null} driver driver document data
 * @param {{nowMs?:number, availabilityStatus?:string, hasActiveRide?:boolean}} [args]
 * @returns {{state:'healthy'|'delayed'|'invisible', visible:boolean, ageMs:number}}
 */
export function driverDispatchVisibility(driver, args = {}) {
  const nowMs = Number(args.nowMs) > 0 ? Number(args.nowMs) : Date.now();
  const status = args.availabilityStatus || driver?.availabilityStatus || null;

  // Only a driver who believes he is available can be misled, and an accepted
  // ride has its own screen: never cover it with a visibility warning.
  if (status !== 'online' || args.hasActiveRide === true) {
    return { state: 'healthy', visible: false, ageMs: 0 };
  }

  const updatedAtMs = workSessionUpdatedAtMs(driver);
  if (!(updatedAtMs > 0)) {
    // Online with no session timestamp at all: dispatch cannot see him either.
    return { state: 'invisible', visible: true, ageMs: Infinity };
  }

  // A phone clock briefly ahead of the server must never raise a false alarm.
  const ageMs = Math.max(0, nowMs - updatedAtMs);
  if (ageMs > WORK_SESSION_DISPATCH_LEASE_MS) {
    return { state: 'invisible', visible: true, ageMs };
  }
  if (ageMs > DISPATCH_VISIBILITY_WARNING_MS) {
    return { state: 'delayed', visible: true, ageMs };
  }
  return { state: 'healthy', visible: false, ageMs };
}
