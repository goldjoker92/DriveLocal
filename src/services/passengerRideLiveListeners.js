// Passenger active-ride listeners.
//
// Multiple UI surfaces (the main ride screen and quick-message guard) need the
// same ride document. This module multiplexes those subscribers onto one
// Firestore listener per ride and suppresses metadata-only duplicate renders.
// It preserves the same server-authoritative ride recovery hint behavior.

import { doc, onSnapshot } from 'firebase/firestore';

import { auth, db } from '../config/firebase';
import { logRideClientEvent } from '../utils/clientRideLog';
import {
  clearRideRecoveryHint,
  reportFirestoreListenerError,
  reportFirestoreSnapshot,
  saveRideRecoveryHint,
} from './networkRecoveryService';
import { isTerminalRideStatus } from './networkRecoveryPolicy';

const rideEntries = new Map();
const locationEntries = new Map();
const LOCATION_LOG_INTERVAL_MS = 30_000;

function semanticSignature(value) {
  if (value == null) return 'null';
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

async function syncPassengerRideHint(ride) {
  const uid = auth.currentUser?.uid;
  if (!uid || !ride?.rideId) return;
  if (isTerminalRideStatus(ride.status)) {
    await clearRideRecoveryHint({ uid, rideId: ride.rideId });
    return;
  }
  await saveRideRecoveryHint({
    uid,
    role: 'passenger',
    rideId: ride.rideId,
    status: ride.status,
  });
}

function fanOut(entry, field, payload) {
  entry.subscribers.forEach((subscriber) => {
    try {
      subscriber[field]?.(payload);
    } catch (_error) {
      // One mounted surface must never break delivery to the others.
    }
  });
}

// A Firestore listener error is terminal: the SDK never re-attaches it. Before
// this, one error (auth not restored yet after a cold start, a transient rules
// evaluation failure) left the passenger's map empty until they left the screen.
// Re-attach with a bounded backoff while someone is still listening.
const LISTENER_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];

function scheduleListenerRetry(entry, entries, rideId, attach, scope) {
  entry.unsubscribeNative?.();
  entry.unsubscribeNative = null;
  // Subscribers reset their state on error: the next snapshot must reach them
  // even when it carries the same position as before.
  entry.lastSignature = null;
  if (entry.retryTimer || entry.subscribers.size === 0) return;
  const attempt = entry.retryCount || 0;
  const delayMs = LISTENER_RETRY_DELAYS_MS[Math.min(attempt, LISTENER_RETRY_DELAYS_MS.length - 1)];
  entry.retryCount = attempt + 1;
  logRideClientEvent(`${scope}.listener_retry_scheduled`, {
    rideId, delayMs, attempt: entry.retryCount, shared: true,
  });
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (entry.subscribers.size === 0 || entries.get(rideId) !== entry) return;
    attach();
  }, delayMs);
}

function stopEntry(entry) {
  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  entry.retryTimer = null;
  entry.unsubscribeNative?.();
  entry.unsubscribeNative = null;
}

function createRideEntry(rideId) {
  const entry = {
    subscribers: new Map(),
    lastValue: undefined,
    lastSignature: null,
    unsubscribeNative: null,
  };

  logRideClientEvent('ride.snapshot.listener_started', {
    rideId,
    shared: true,
  });

  const attach = () => {
  entry.unsubscribeNative = onSnapshot(
    doc(db, 'rideRequests', rideId),
    { includeMetadataChanges: true },
    (snap) => {
      entry.retryCount = 0;
      reportFirestoreSnapshot('ride_snapshot', snap.metadata || {});
      const ride = snap.exists() ? { rideId: snap.id, ...snap.data() } : null;
      const signature = semanticSignature(ride);

      // Cache/server metadata changes often contain exactly the same ride. They are
      // still reported to network recovery, but do not trigger duplicate renders,
      // duplicate phase logs or duplicate recovery-hint writes.
      if (entry.lastSignature === signature) return;
      entry.lastSignature = signature;
      entry.lastValue = ride;

      logRideClientEvent('ride.snapshot.received', {
        rideId,
        status: ride?.status || 'missing',
        source: snap.metadata?.fromCache ? 'cache' : 'server',
        shared: true,
        subscriberCount: entry.subscribers.size,
        ride,
      });
      if (ride) syncPassengerRideHint(ride).catch(() => undefined);
      fanOut(entry, 'onData', ride);
    },
    (error) => {
      reportFirestoreListenerError('ride_snapshot', error);
      logRideClientEvent('ride.snapshot.listener_failed', { rideId, error, shared: true }, 'error');
      fanOut(entry, 'onError', error);
      scheduleListenerRetry(entry, rideEntries, rideId, attach, 'ride.snapshot');
    },
  );
  };
  attach();

  rideEntries.set(rideId, entry);
  return entry;
}

export function listenToPassengerRide(rideId, onData, onError) {
  if (!rideId || typeof onData !== 'function') return () => {};
  const entry = rideEntries.get(rideId) || createRideEntry(rideId);
  const subscriptionId = Symbol(rideId);
  entry.subscribers.set(subscriptionId, { onData, onError });

  if (entry.lastValue !== undefined) {
    Promise.resolve().then(() => {
      if (entry.subscribers.has(subscriptionId)) onData(entry.lastValue);
    });
  }

  return () => {
    entry.subscribers.delete(subscriptionId);
    if (entry.subscribers.size > 0) return;
    stopEntry(entry);
    rideEntries.delete(rideId);
    logRideClientEvent('ride.snapshot.listener_stopped', { rideId, shared: true });
  };
}

function createLocationEntry(rideId) {
  const entry = {
    subscribers: new Map(),
    lastValue: undefined,
    lastSignature: null,
    lastLogAtMs: 0,
    lastLoggedStatus: null,
    unsubscribeNative: null,
  };

  logRideClientEvent('ride.location.listener_started', { rideId, shared: true });

  const attach = () => {
  entry.unsubscribeNative = onSnapshot(
    doc(db, 'activeRideLocations', rideId),
    { includeMetadataChanges: true },
    (snap) => {
      entry.retryCount = 0;
      reportFirestoreSnapshot('ride_location', snap.metadata || {});
      const location = snap.exists() ? { rideId: snap.id, ...snap.data() } : null;
      const signature = semanticSignature(location);
      if (entry.lastSignature === signature) return;

      entry.lastSignature = signature;
      entry.lastValue = location;
      const status = location ? 'available' : 'missing';
      const nowMs = Date.now();
      const shouldLog = entry.lastLogAtMs === 0
        || entry.lastLoggedStatus !== status
        || nowMs - entry.lastLogAtMs >= LOCATION_LOG_INTERVAL_MS;

      if (shouldLog) {
        entry.lastLogAtMs = nowMs;
        entry.lastLoggedStatus = status;
        logRideClientEvent('ride.location.snapshot_received', {
          rideId,
          status,
          source: snap.metadata?.fromCache ? 'cache' : 'server',
          shared: true,
          logPolicy: 'state_or_30s',
        });
      }

      // Every real position still reaches the map. Only diagnostic logging is
      // throttled; GPS publication and passenger tracking behavior are untouched.
      fanOut(entry, 'onData', location);
    },
    (error) => {
      reportFirestoreListenerError('ride_location', error);
      logRideClientEvent('ride.location.listener_failed', { rideId, error, shared: true }, 'error');
      fanOut(entry, 'onError', error);
      scheduleListenerRetry(entry, locationEntries, rideId, attach, 'ride.location');
    },
  );
  };
  attach();

  locationEntries.set(rideId, entry);
  return entry;
}

export function listenToPassengerRideLocation(rideId, onData, onError) {
  if (!rideId || typeof onData !== 'function') return () => {};
  const entry = locationEntries.get(rideId) || createLocationEntry(rideId);
  const subscriptionId = Symbol(rideId);
  entry.subscribers.set(subscriptionId, { onData, onError });

  if (entry.lastValue !== undefined) {
    Promise.resolve().then(() => {
      if (entry.subscribers.has(subscriptionId)) onData(entry.lastValue);
    });
  }

  return () => {
    entry.subscribers.delete(subscriptionId);
    if (entry.subscribers.size > 0) return;
    stopEntry(entry);
    locationEntries.delete(rideId);
    logRideClientEvent('ride.location.listener_stopped', { rideId, shared: true });
  };
}
