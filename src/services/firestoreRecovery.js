// Bounded Firestore read fallback. Cached documents may restore presentation and
// navigation, but they never confirm connectivity or authorize a server mutation.

import { getDoc, getDocFromCache } from 'firebase/firestore';

import { isConnectivityError } from './networkRecoveryPolicy';
import {
  reportFirestoreListenerError,
  reportFirestoreSnapshot,
} from './networkRecoveryService';

function trace(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[FIRESTORE_RECOVERY] ${event}`, {
    scope: 'firestore_recovery',
    event,
    atMs: Date.now(),
    ...details,
  });
}

export async function getDocumentWithCacheFallback(documentRef, source) {
  try {
    const snapshot = await getDoc(documentRef);
    reportFirestoreSnapshot(source, snapshot.metadata || {});
    trace('read.succeeded', {
      source,
      result: snapshot.metadata?.fromCache ? 'cache' : 'server',
      exists: snapshot.exists(),
    });
    return snapshot;
  } catch (error) {
    reportFirestoreListenerError(source, error);
    if (!isConnectivityError(error)) throw error;
    try {
      const cached = await getDocFromCache(documentRef);
      trace('read.cache_fallback_succeeded', {
        source,
        result: 'cache',
        exists: cached.exists(),
      });
      return cached;
    } catch (_cacheError) {
      trace('read.cache_fallback_missing', {
        source,
        result: 'unavailable',
      }, 'warn');
      throw error;
    }
  }
}
