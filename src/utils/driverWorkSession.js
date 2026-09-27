// Shared server/mobile policy. Keeping a shift recoverable does not mean a
// driver is currently eligible for new offers.
import { evaluateDriverDispatchReadiness } from '../../functions/src/drivers/dispatchReadiness';
import C from '../../functions/src/rides/constants';

export const WORK_SESSION_DISPATCH_LEASE_MS = C.AVAILABILITY_SESSION_MAX_AGE_MS;
export const WORK_SESSION_ABANDONED_MAX_AGE_MS = C.WORK_SESSION_ABANDONED_MAX_AGE_MS;

// The driver stops being offered rides well before his shift is at risk. This
// is the point where the app must SAY so instead of showing "disponível":
// silence plus a reassuring label is what makes a working driver give up.
export const DISPATCH_VISIBILITY_WARNING_MS = C.DISPATCH_VISIBILITY_WARNING_MS;

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

// Account, work session and dispatch readiness are separate states. Local
// cache/pending writes never provide the confirmation needed for a green badge.
export function driverDispatchVisibility(driver, args = {}) {
  const nowMs = Number(args.nowMs) > 0 ? Number(args.nowMs) : Date.now();
  const status = args.availabilityStatus || driver?.availabilityStatus || 'offline';
  const view = (state, reason, extra = {}) => ({
    state, reason, ready: state === 'healthy',
    visible: !['healthy', 'offline', 'on_ride'].includes(state), ...extra,
  });
  if (args.hasActiveRide || driver?.activeRideId) return view('on_ride', 'active_ride');
  if (!driver) return view('checking', 'profile_loading');
  if (status !== 'online') {
    return driver.availabilityClosedReason
      ? view('invisible', driver.availabilityClosedReason, { workSessionOpen: false })
      : view('offline', 'offline', { workSessionOpen: false });
  }
  if (args.snapshotConfirmed === false || args.fromCache === true || args.policyConfirmed === false) {
    return view('checking', 'server_unconfirmed');
  }
  if (args.networkStatus === 'offline' || args.networkStatus === 'reconnecting') {
    return view('checking', 'network_unavailable');
  }
  if (args.localSessionKnown === false) return view('checking', 'local_session_loading');
  if (args.localSessionKnown === true && args.localSessionId !== driver.availabilitySessionId) {
    return view('invisible', 'local_session_missing');
  }
  if (args.deviceKnown === false) return view('checking', 'device_checking');
  if (args.deviceDiagnostic?.blocking) {
    return view('invisible', args.deviceDiagnostic.primaryIssue?.code || 'device_blocked');
  }
  if (args.deviceDiagnostic?.primaryIssue?.code === 'diagnostic_failed') {
    return view('checking', 'device_checking');
  }
  const evaluated = evaluateDriverDispatchReadiness(driver, {
    nowMs, driverBuildPolicy: args.driverBuildPolicy || {},
  });
  const state = !evaluated.ready ? 'invisible' : evaluated.delayed ? 'delayed' : 'healthy';
  return view(state, evaluated.ready && evaluated.delayed ? 'location_delayed' : evaluated.reason, {
    ageMs: Math.max(evaluated.sessionAgeMs, evaluated.locationAgeMs),
    locationAgeMs: evaluated.locationAgeMs, sessionAgeMs: evaluated.sessionAgeMs,
    dispatchable: evaluated.ready, workSessionOpen: true,
  });
}
