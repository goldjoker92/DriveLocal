// @ts-check
// processRideNotificationEvent — the Firestore onCreate trigger logic for
// notificationEvents. Loads the recipient's active Android tokens, sends through
// Firebase Admin Messaging (real), records a safe result, disables invalid
// tokens, and is idempotent (a re-run on an already-processed event is ignored).
//
// The message carries data STRINGS ONLY; no coordinates/address/Pix/wallet/PII.

const admin = require('firebase-admin');
const { logInfo, logWarning } = require('../logging/logger');
const C = require('../rides/constants');

// FCM error codes meaning the token is dead and must be disabled.
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

function dataPayload(event) {
  return {
    notificationId: String(event.notificationId),
    eventType: String(event.eventType),
    rideId: String(event.rideId),
    offerId: event.offerId ? String(event.offerId) : '',
    recipientRole: String(event.recipientRole),
    route: event.route ? String(event.route) : '',
    traceId: event.traceId ? String(event.traceId) : '',
  };
}

/**
 * @param {{db:object, messaging:object, eventRef:object, event:object, context:object, clock:{now:()=>number}}} args
 */
async function processRideNotificationEvent({ db, messaging, eventRef, event, context, clock }) {
  // Idempotent: only a still-pending event is processed.
  if (!event || event.status !== C.NOTIFICATION_STATUS.PENDING) {
    logInfo(context, 'notification.duplicate_ignored', { operation: 'notify', notificationId: event && event.notificationId });
    return { skipped: true };
  }
  const nowMs = clock.now();

  const snap = await db
    .collection(C.NOTIFICATION_TOKENS)
    .where('uid', '==', event.recipientUid)
    .where('active', '==', true)
    .get();
  const targets = [];
  snap.forEach((d) => {
    const t = d.data() || {};
    if (t.platform === 'android' && t.token) targets.push({ ref: d.ref, token: t.token });
  });

  if (targets.length === 0) {
    await eventRef.set({ status: C.NOTIFICATION_STATUS.FAILED, failureReason: 'no_active_tokens', processedAtMs: nowMs, attemptCount: (event.attemptCount || 0) + 1 }, { merge: true });
    logWarning(context, 'notification.failed', { operation: 'notify', notificationId: event.notificationId, reasonCode: 'no_active_tokens' });
    return { status: C.NOTIFICATION_STATUS.FAILED, successCount: 0, failureCount: 0 };
  }

  const resp = await messaging.sendEachForMulticast({
    tokens: targets.map((t) => t.token),
    data: dataPayload(event),
    android: { priority: 'high' },
  });

  let successCount = 0;
  let failureCount = 0;
  const disables = [];
  (resp.responses || []).forEach((r, i) => {
    if (r && r.success) {
      successCount += 1;
    } else {
      failureCount += 1;
      const code = r && r.error && r.error.code;
      if (INVALID_TOKEN_CODES.has(code)) {
        disables.push(targets[i].ref.set({ active: false, disabledReason: code, disabledAtMs: nowMs }, { merge: true }));
      }
    }
  });
  await Promise.all(disables);

  const status =
    failureCount === 0
      ? C.NOTIFICATION_STATUS.SENT
      : successCount > 0
        ? C.NOTIFICATION_STATUS.PARTIALLY_FAILED
        : C.NOTIFICATION_STATUS.FAILED;
  await eventRef.set({ status, successCount, failureCount, processedAtMs: nowMs, attemptCount: (event.attemptCount || 0) + 1 }, { merge: true });

  const logEvent = status === C.NOTIFICATION_STATUS.FAILED ? 'notification.failed' : 'notification.sent';
  logInfo(context, logEvent, { operation: 'notify', notificationId: event.notificationId, rideId: event.rideId, eventType: event.eventType, successCount, failureCount });
  return { status, successCount, failureCount };
}

module.exports = { processRideNotificationEvent, INVALID_TOKEN_CODES };
