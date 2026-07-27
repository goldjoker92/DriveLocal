// Secure passenger ride-history client. Every page comes from the authenticated
// Cloud Function; the mobile app never queries private rideRequests directly.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

const getPassengerRideHistorySecure = httpsCallable(functions, 'getPassengerRideHistorySecure');

function safeCursor(cursor) {
  if (!cursor || typeof cursor !== 'object') return null;
  const beforeCreatedAtMs = Number(cursor.beforeCreatedAtMs || 0);
  const beforeRideId = typeof cursor.beforeRideId === 'string' ? cursor.beforeRideId : '';
  if (!(beforeCreatedAtMs > 0) || !beforeRideId) return null;
  return { beforeCreatedAtMs, beforeRideId };
}

export async function loadPassengerRideHistoryPage({ limit = 20, cursor = null } = {}) {
  const startedAt = Date.now();
  const normalizedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 20)));
  const normalizedCursor = safeCursor(cursor);
  const payload = { limit: normalizedLimit };
  if (normalizedCursor) Object.assign(payload, normalizedCursor);

  console.info('[PASSENGER_HISTORY] page.requested', {
    scope: 'passenger_history',
    event: 'page.requested',
    limit: normalizedLimit,
    hasCursor: Boolean(normalizedCursor),
    atMs: startedAt,
  });

  try {
    const response = await getPassengerRideHistorySecure(payload);
    const data = response?.data && typeof response.data === 'object' ? response.data : {};
    const result = {
      version: data.version || null,
      items: Array.isArray(data.items) ? data.items : [],
      nextCursor: safeCursor(data.nextCursor),
      hasMore: data.hasMore === true,
    };
    console.info('[PASSENGER_HISTORY] page.loaded', {
      scope: 'passenger_history',
      event: 'page.loaded',
      version: result.version,
      itemCount: result.items.length,
      hasMore: result.hasMore,
      durationMs: Date.now() - startedAt,
      atMs: Date.now(),
    });
    return result;
  } catch (error) {
    console.warn('[PASSENGER_HISTORY] page.failed', {
      scope: 'passenger_history',
      event: 'page.failed',
      reason: error?.details?.code || error?.code || error?.message || 'unknown',
      durationMs: Date.now() - startedAt,
      atMs: Date.now(),
    });
    throw error;
  }
}