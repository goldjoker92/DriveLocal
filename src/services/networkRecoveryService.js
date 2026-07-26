// Shared connectivity and safe-recovery service.
//
// There is deliberately no automatic action replay. For an uncertain callable we
// retain only its idempotency key; the user must press again and the server then
// recognizes the retry as the same operation.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { auth } from '../config/firebase';
import {
  NETWORK_ACTION_TIMEOUT_MS,
  NETWORK_STATUS,
  PENDING_ACTION_MAX_AGE_MS,
  classifyNetworkError,
  isConnectivityError,
  isTerminalRideStatus,
  sanitizeRideRecoveryHint,
  stableLocalOwnerHash,
} from './networkRecoveryPolicy';

const RIDE_RECOVERY_KEY = '@drivelocal/ride-recovery-v1';
const PENDING_ACTIONS_KEY = '@drivelocal/pending-network-actions-v1';
const CONNECTIVITY_PROBE_TIMEOUT_MS = 12 * 1000;
const CONNECTIVITY_PROBE_MIN_INTERVAL_MS = 8 * 1000;

let networkState = Object.freeze({
  status: NETWORK_STATUS.UNKNOWN,
  lastChangedAtMs: Date.now(),
  lastSuccessAtMs: 0,
  lastFailureAtMs: 0,
  lastRecoveredAtMs: 0,
  lastFailureCategory: null,
  lastSource: null,
});
const subscribers = new Set();
let probeInFlight = null;
let lastProbeStartedAtMs = 0;
let pendingActionsMutation = Promise.resolve();

function trace(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[NETWORK_RECOVERY] ${event}`, {
    scope: 'network_recovery',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function publish(patch) {
  const nextStatus = patch.status || networkState.status;
  const changed = nextStatus !== networkState.status;
  networkState = Object.freeze({
    ...networkState,
    ...patch,
    status: nextStatus,
    lastChangedAtMs: changed ? Date.now() : networkState.lastChangedAtMs,
  });
  subscribers.forEach((listener) => {
    try {
      listener(networkState);
    } catch (_error) {
      // One visual subscriber must never break connectivity tracking for the app.
    }
  });
  return networkState;
}

export function getNetworkRecoveryState() {
  return networkState;
}

export function subscribeNetworkRecovery(listener) {
  if (typeof listener !== 'function') return () => undefined;
  subscribers.add(listener);
  listener(networkState);
  return () => subscribers.delete(listener);
}

export function markNetworkActivitySucceeded(source = 'unknown') {
  const nowMs = Date.now();
  const recovered = [NETWORK_STATUS.OFFLINE, NETWORK_STATUS.RECONNECTING].includes(networkState.status);
  const next = publish({
    status: NETWORK_STATUS.ONLINE,
    lastSuccessAtMs: nowMs,
    lastRecoveredAtMs: recovered ? nowMs : networkState.lastRecoveredAtMs,
    lastFailureCategory: null,
    lastSource: source,
  });
  if (recovered) {
    trace('connection.recovered', { source, result: 'online' });
  }
  return next;
}

export function markNetworkActivityFailed(error, source = 'unknown') {
  const category = classifyNetworkError(error);
  if (!['offline', 'timeout'].includes(category)) return networkState;
  const next = publish({
    status: NETWORK_STATUS.OFFLINE,
    lastFailureAtMs: Date.now(),
    lastFailureCategory: category,
    lastSource: source,
  });
  trace('connection.unavailable', { source, category, result: 'offline' }, 'warn');
  return next;
}

export function reportFirestoreSnapshot(source, metadata = {}) {
  if (metadata?.fromCache === true) {
    trace('firestore.cache_snapshot', {
      source,
      hasPendingWrites: metadata?.hasPendingWrites === true,
      result: 'cache_only',
    });
    return networkState;
  }
  return markNetworkActivitySucceeded(source);
}

export function reportFirestoreListenerError(source, error) {
  return markNetworkActivityFailed(error, source);
}

function timeoutError(actionName) {
  const error = new Error('A operação demorou mais que o esperado.');
  error.code = 'client-timeout';
  error.actionName = actionName;
  return error;
}

async function withTimeout(actionName, operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(actionName)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runNetworkAwareAction(
  actionName,
  operation,
  { timeoutMs = NETWORK_ACTION_TIMEOUT_MS } = {}
) {
  if (networkState.status === NETWORK_STATUS.OFFLINE) {
    publish({ status: NETWORK_STATUS.RECONNECTING, lastSource: actionName });
  }
  const startedAtMs = Date.now();
  trace('action.started', { actionName, timeoutMs });
  try {
    const result = await withTimeout(actionName, operation, timeoutMs);
    markNetworkActivitySucceeded(`action:${actionName}`);
    trace('action.succeeded', {
      actionName,
      durationMs: Date.now() - startedAtMs,
      result: 'confirmed',
    });
    return result;
  } catch (error) {
    const category = classifyNetworkError(error);
    markNetworkActivityFailed(error, `action:${actionName}`);
    trace('action.failed', {
      actionName,
      category,
      durationMs: Date.now() - startedAtMs,
      result: isConnectivityError(error) ? 'confirmation_uncertain' : 'rejected',
    }, 'warn');
    error.networkCategory = category;
    throw error;
  }
}

function randomIdempotencyKey(prefix) {
  const safePrefix = String(prefix || 'net').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'net';
  const first = Math.random().toString(36).slice(2, 12);
  const second = Math.random().toString(36).slice(2, 12);
  return `${safePrefix}-${first}${second}`.slice(0, 40);
}

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function mutatePendingActions(mutator) {
  const operation = pendingActionsMutation.then(async () => {
    const nowMs = Date.now();
    const current = await readJson(PENDING_ACTIONS_KEY, {});
    const pruned = Object.fromEntries(
      Object.entries(current).filter(([, value]) => Number(value?.expiresAtMs || 0) > nowMs)
    );
    const result = await mutator(pruned, nowMs);
    await AsyncStorage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(pruned));
    return result;
  });
  pendingActionsMutation = operation.catch(() => undefined);
  return operation;
}

async function pendingIdempotencyKey(actionKey, prefix) {
  const actionHash = stableLocalOwnerHash(actionKey);
  return mutatePendingActions((actions, nowMs) => {
    const existing = actions[actionHash];
    if (existing?.idempotencyKey && Number(existing.expiresAtMs || 0) > nowMs) {
      return { actionHash, idempotencyKey: existing.idempotencyKey, reused: true };
    }
    const idempotencyKey = randomIdempotencyKey(prefix);
    actions[actionHash] = {
      idempotencyKey,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + PENDING_ACTION_MAX_AGE_MS,
    };
    return { actionHash, idempotencyKey, reused: false };
  });
}

async function clearPendingAction(actionHash, expectedIdempotencyKey) {
  await mutatePendingActions((actions) => {
    if (actions[actionHash]?.idempotencyKey === expectedIdempotencyKey) {
      delete actions[actionHash];
    }
  });
}

export async function runRecoverableAction({
  actionName,
  actionKey,
  idempotencyPrefix,
  execute,
  timeoutMs = NETWORK_ACTION_TIMEOUT_MS,
}) {
  const pending = await pendingIdempotencyKey(`${actionName}:${actionKey}`, idempotencyPrefix);
  trace('idempotency.prepared', {
    actionName,
    reused: pending.reused,
    result: pending.reused ? 'uncertain_retry' : 'new_attempt',
  });
  try {
    const result = await runNetworkAwareAction(
      actionName,
      () => execute(pending.idempotencyKey),
      { timeoutMs }
    );
    await clearPendingAction(pending.actionHash, pending.idempotencyKey);
    return result;
  } catch (error) {
    if (!isConnectivityError(error)) {
      // A definitive server/business rejection is not uncertain and must not poison
      // a future, legitimately different attempt with an old idempotency key.
      await clearPendingAction(pending.actionHash, pending.idempotencyKey);
    }
    throw error;
  }
}

export async function probeConnectivity({ force = false } = {}) {
  const nowMs = Date.now();
  if (probeInFlight) return probeInFlight;
  if (!force && nowMs - lastProbeStartedAtMs < CONNECTIVITY_PROBE_MIN_INTERVAL_MS) {
    return networkState;
  }
  const user = auth.currentUser;
  if (!user) return networkState;

  lastProbeStartedAtMs = nowMs;
  if (networkState.status === NETWORK_STATUS.OFFLINE) {
    publish({ status: NETWORK_STATUS.RECONNECTING, lastSource: 'auth_probe' });
  }
  probeInFlight = (async () => {
    try {
      // Force-refresh talks to Firebase Auth and therefore acts as a bounded network
      // probe without adding a native connectivity dependency or an external tracker.
      await withTimeout('connectivity_probe', () => user.getIdToken(true), CONNECTIVITY_PROBE_TIMEOUT_MS);
      return markNetworkActivitySucceeded('auth_probe');
    } catch (error) {
      markNetworkActivityFailed(error, 'auth_probe');
      trace('probe.failed', {
        category: classifyNetworkError(error),
        result: isConnectivityError(error) ? 'offline' : 'auth_or_unknown',
      }, 'warn');
      return networkState;
    } finally {
      probeInFlight = null;
    }
  })();
  return probeInFlight;
}

export async function saveRideRecoveryHint({ uid, role, rideId, status }) {
  if (!uid || !rideId) return null;
  if (isTerminalRideStatus(status)) {
    await clearRideRecoveryHint({ uid, rideId });
    return null;
  }
  const hint = sanitizeRideRecoveryHint({
    ownerHash: stableLocalOwnerHash(uid),
    role,
    rideId,
    status,
    recordedAtMs: Date.now(),
  });
  if (!hint) return null;
  await AsyncStorage.setItem(RIDE_RECOVERY_KEY, JSON.stringify(hint));
  trace('ride_hint.saved', { role, status: hint.status, result: 'recoverable' });
  return hint;
}

export async function loadRideRecoveryHint(uid) {
  if (!uid) return null;
  const raw = await readJson(RIDE_RECOVERY_KEY, null);
  const hint = sanitizeRideRecoveryHint(raw || {}, Date.now());
  if (!hint || hint.ownerHash !== stableLocalOwnerHash(uid)) {
    if (raw) await AsyncStorage.removeItem(RIDE_RECOVERY_KEY).catch(() => undefined);
    return null;
  }
  return hint;
}

export async function clearRideRecoveryHint({ uid = null, rideId = null } = {}) {
  const raw = await readJson(RIDE_RECOVERY_KEY, null);
  if (!raw) return;
  if (uid && raw.ownerHash !== stableLocalOwnerHash(uid)) return;
  if (rideId && raw.rideId !== rideId) return;
  await AsyncStorage.removeItem(RIDE_RECOVERY_KEY);
  trace('ride_hint.cleared', { result: 'terminal_or_account_change' });
}

export function networkErrorMessage(error, fallback = 'Não foi possível concluir. Tente novamente.') {
  const category = classifyNetworkError(error);
  if (category === 'offline') {
    return 'Sem conexão. A ação não foi repetida. Reconecte e toque novamente para confirmar.';
  }
  if (category === 'timeout') {
    return 'A confirmação demorou. Verifique o estado atualizado antes de tentar novamente.';
  }
  if (category === 'auth') {
    return 'Sua sessão precisa ser atualizada. Entre novamente para continuar.';
  }
  return error?.details?.message || error?.message || fallback;
}

// Test-only reset keeps executable unit tests isolated without exposing pending
// action contents to production callers.
export async function __resetNetworkRecoveryForTests() {
  networkState = Object.freeze({
    status: NETWORK_STATUS.UNKNOWN,
    lastChangedAtMs: Date.now(),
    lastSuccessAtMs: 0,
    lastFailureAtMs: 0,
    lastRecoveredAtMs: 0,
    lastFailureCategory: null,
    lastSource: null,
  });
  probeInFlight = null;
  lastProbeStartedAtMs = 0;
  pendingActionsMutation = Promise.resolve();
  await AsyncStorage.multiRemove([RIDE_RECOVERY_KEY, PENDING_ACTIONS_KEY]);
}
