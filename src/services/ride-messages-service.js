import { httpsCallable } from 'firebase/functions';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db, functions } from '../config/firebase';
import { listenToRideQuickMessages } from './ridesService';

// Allowlisted metadata only: never pass a message object, text or raw Error here.
export function traceMessage(event, { rideId, messageId, traceId, sequence, reason, role } = {}) {
  console.info('[RIDE_MESSAGE]', { event, rideId, messageId, traceId, sequence, reason, role });
}

export function openRideConversation(rideId) {
  return httpsCallable(functions, 'openRideConversationSecure', { timeout: 15000 })({ rideId })
    .then((response) => response.data);
}

export function newMessageKey() {
  // Random Firestore IDs require no write and carry no text or account details.
  return `msg_${doc(collection(db, '_localMessageIds')).id}`;
}

export async function sendConversationMessage(rideId, attempt, uid) {
  if (!uid || auth.currentUser?.uid !== uid) throw Object.assign(new Error('Session changed'), { code: 'unauthenticated' });
  const preset = Boolean(attempt.messageCode);
  const name = preset ? 'sendRideQuickMessageSecure' : 'sendRideMessageSecure';
  traceMessage('send.requested', { rideId, messageId: attempt.idempotencyKey });
  try {
    const result = (await httpsCallable(functions, name, { timeout: 15000 })({
      rideId, idempotencyKey: attempt.idempotencyKey,
      ...(preset ? { messageCode: attempt.messageCode } : { text: attempt.text }),
    })).data;
    traceMessage('send.succeeded', { rideId, ...result });
    return result;
  } catch (error) {
    traceMessage('send.failed', {
      rideId, messageId: error?.details?.metadata?.messageId || attempt.idempotencyKey,
      traceId: error?.details?.metadata?.traceId,
      reason: error?.details?.metadata?.reason || error?.details?.code || error?.code || 'unknown',
    });
    throw error;
  }
}

export function mergeConversationMessages(current, legacy) {
  const bySequence = new Map();
  [...legacy, ...current].forEach((message) => bySequence.set(message.sequence, message));
  return [...bySequence.values()].sort((a, b) => Number(b.sequence) - Number(a.sequence));
}

export function listenToConversation(rideId, pageSize, onData, onError) {
  let current = [];
  let legacy = [];
  let received = false;
  let disposed = false;
  const publish = () => {
    if (!disposed && received) onData({ messages: mergeConversationMessages(current, legacy), hasMore: current.length >= pageSize });
  };
  const fail = (error) => { if (!disposed) onError(error); };
  const stop = onSnapshot(query(collection(db, 'rideRequests', rideId, 'messages'), orderBy('sequence', 'desc'), limit(pageSize)),
    (snapshot) => {
      current = snapshot.docs.map((entry) => ({ ...entry.data(), messageId: entry.id }));
      received = true;
      publish();
    }, fail);
  // Existing in-flight rides may still contain up to six pre-release messages.
  // Canonical entries take precedence so dual writes never show duplicate bubbles.
  const stopLegacy = listenToRideQuickMessages(rideId, (items) => { legacy = items; publish(); }, fail);
  return () => { disposed = true; stop(); stopLegacy(); };
}

export function listenToConversationReadiness(rideId, onData, onError) {
  return onSnapshot(doc(db, 'rideRequests', rideId, 'conversation', 'state'),
    (snapshot) => onData(snapshot.exists() && snapshot.data().driver === true && snapshot.data().passenger === true), onError);
}
