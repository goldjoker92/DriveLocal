// Pure network/recovery policy. No Firebase or React Native imports so the rules
// remain deterministic and directly testable.

export const NETWORK_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  ONLINE: 'online',
  OFFLINE: 'offline',
  RECONNECTING: 'reconnecting',
});

export const RIDE_RECOVERY_HINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const NETWORK_ACTION_TIMEOUT_MS = 25 * 1000;
export const PENDING_ACTION_MAX_AGE_MS = 10 * 60 * 1000;

const TERMINAL_RIDE_STATUSES = new Set([
  'completed',
  'cancelled',
  'disputed',
  'no_driver_available',
  'dispatch_failed',
]);

const CONNECTIVITY_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'network-request-failed',
  'auth/network-request-failed',
  'functions/unavailable',
  'functions/deadline-exceeded',
  'firestore/unavailable',
  'storage/retry-limit-exceeded',
]);

const AUTH_CODES = new Set([
  'unauthenticated',
  'functions/unauthenticated',
  'auth/user-token-expired',
  'auth/user-disabled',
  'auth/invalid-user-token',
]);

function normalizedCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^firebaseerror:\s*/, '');
}

export function normalizeNetworkErrorCode(error) {
  const direct = normalizedCode(error?.code);
  if (direct) return direct;
  const details = normalizedCode(error?.details?.code || error?.details?.errorCode);
  if (details) return details;
  const message = normalizedCode(error?.message);
  if (message.includes('timeout') || message.includes('timed out')) return 'client-timeout';
  if (message.includes('network request failed')) return 'network-request-failed';
  return 'unknown';
}

export function classifyNetworkError(error) {
  const code = normalizeNetworkErrorCode(error);
  if (code === 'client-timeout' || code.includes('deadline-exceeded')) return 'timeout';
  if (CONNECTIVITY_CODES.has(code) || code.endsWith('/unavailable')) return 'offline';
  if (AUTH_CODES.has(code) || code.endsWith('/unauthenticated')) return 'auth';
  if (
    code.includes('permission-denied')
    || code.includes('invalid-argument')
    || code.includes('failed-precondition')
    || code.includes('already-exists')
    || code.includes('not-found')
    || code.includes('resource-exhausted')
    || code.includes('idempotency-conflict')
  ) {
    return 'business';
  }
  return 'unknown';
}

export function isConnectivityError(error) {
  const category = classifyNetworkError(error);
  return category === 'offline' || category === 'timeout';
}

export function isTerminalRideStatus(status) {
  return TERMINAL_RIDE_STATUSES.has(String(status || ''));
}

export function stableLocalOwnerHash(value) {
  const text = String(value || '');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function safeIdentifier(value, maxLength = 180) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) return null;
  return /^[A-Za-z0-9_.:\-]+$/.test(text) ? text : null;
}

export function sanitizeRideRecoveryHint(input = {}, nowMs = Date.now()) {
  const role = input.role === 'driver' || input.role === 'passenger' ? input.role : null;
  const rideId = safeIdentifier(input.rideId);
  const ownerHash = safeIdentifier(input.ownerHash, 40);
  const status = String(input.status || '').trim().slice(0, 40);
  const recordedAtMs = Number(input.recordedAtMs || nowMs);
  if (!role || !rideId || !ownerHash || !Number.isFinite(recordedAtMs)) return null;
  if (recordedAtMs > nowMs + 60 * 1000) return null;
  if (nowMs - recordedAtMs > RIDE_RECOVERY_HINT_MAX_AGE_MS) return null;
  if (isTerminalRideStatus(status)) return null;
  return Object.freeze({
    version: 1,
    role,
    rideId,
    ownerHash,
    status: status || 'unknown',
    recordedAtMs: Math.trunc(recordedAtMs),
    expiresAtMs: Math.trunc(recordedAtMs + RIDE_RECOVERY_HINT_MAX_AGE_MS),
  });
}

export function rideRecoveryRoute(hint) {
  if (!hint?.rideId) return null;
  if (hint.role === 'driver') {
    return { pathname: '/active-ride', params: { rideId: hint.rideId, restored: '1' } };
  }
  if (hint.role === 'passenger') {
    // /searching is the passenger recovery router: it reads the authoritative ride
    // status and redirects to assigned, Pix or completion without trusting local state.
    return { pathname: '/searching', params: { rideId: hint.rideId, restored: '1' } };
  }
  return null;
}

export function shouldRestoreFromRoute(pathname) {
  const path = String(pathname || '').toLowerCase();
  return new Set([
    '',
    '/',
    '/index',
    '/landing',
    '/driver-home',
    '/passenger-home',
  ]).has(path);
}
