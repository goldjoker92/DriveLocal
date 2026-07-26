// @ts-check
// notificationEvents are created inside the SAME transaction as the ride change
// so a state transition and its notification are atomic. The document id is
// deterministic (rideId_eventType_recipientRole): a duplicate/replayed transition
// re-uses the id, so at most ONE event per (ride, event, recipient) exists — the
// Firestore onCreate trigger therefore fires once.
//
// Payload carries STRINGS ONLY — never coordinates, address, Pix, wallet, phone,
// email or other private data. Quick messages carry a catalog code, never free text.

const admin = require('firebase-admin');
const C = require('../rides/constants');

// dedupeSuffix defaults to recipientRole (one event per ride+event+recipient).
// For fan-out or repeatable events pass a unique, server-generated suffix.
function eventId(rideId, eventType, suffix) {
  return `${rideId}_${eventType}_${suffix}`;
}

/**
 * @param {{rideId:string, eventType:string, recipientUid:string, recipientRole:string,
 *          route:string, offerId?:string, messageCode?:string, traceId?:string,
 *          nowMs:number, dedupeSuffix?:string}} p
 */
function buildNotificationEvent(p) {
  const id = eventId(p.rideId, p.eventType, p.dedupeSuffix || p.recipientRole);
  return {
    id,
    data: {
      notificationId: id,
      eventType: p.eventType,
      rideId: p.rideId,
      offerId: p.offerId || null,
      messageCode: p.messageCode || null,
      recipientUid: p.recipientUid,
      recipientRole: p.recipientRole,
      route: p.route || null,
      traceId: p.traceId || null,
      status: C.NOTIFICATION_STATUS.PENDING,
      attemptCount: 0,
      createdAtMs: p.nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

// Enqueues one notification event inside an open transaction.
function enqueueEventTx(tx, db, event) {
  tx.set(db.collection(C.NOTIFICATION_EVENTS).doc(event.id), event.data);
}

// Enqueues one notification event outside a transaction (deterministic id).
async function enqueueEvent(db, event) {
  await db.collection(C.NOTIFICATION_EVENTS).doc(event.id).set(event.data);
}

module.exports = { buildNotificationEvent, enqueueEventTx, enqueueEvent, eventId };
