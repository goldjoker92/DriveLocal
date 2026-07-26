// @ts-check
// Mirrors the final FCM delivery state onto the cancelled ride. The notification
// event remains the detailed source of truth; the ride stores only operational
// status/attempt metadata for support and admin health views.

const admin = require('firebase-admin');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const C = require('./constants');

const REGION = 'southamerica-east1';

function cancellationDeliveryUpdate(before = {}, after = {}, notificationId) {
  if (after.eventType !== C.NOTIFICATION_EVENT.RIDE_CANCELLED) return null;
  if (!after.rideId || !notificationId) return null;
  if (before.status === after.status && before.attemptCount === after.attemptCount) return null;

  return {
    rideId: String(after.rideId),
    notificationId: String(notificationId),
    status: String(after.status || C.NOTIFICATION_STATUS.PENDING),
    attemptCount: Math.max(0, Number(after.attemptCount || 0)),
    updatedAtMs: Number(
      after.sentAtMs
      || after.failedAtMs
      || after.updatedAtMs
      || Date.now()
    ),
  };
}

const cancellationNotificationStatusTrigger = onDocumentUpdated(
  {
    document: `${C.NOTIFICATION_EVENTS}/{notificationId}`,
    region: REGION,
    retry: false,
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const update = cancellationDeliveryUpdate(before, after, event.params.notificationId);
    if (!update) return null;

    const context = createLoggerContext({
      functionName: 'cancellationNotificationStatusTrigger',
      actorType: 'system',
    });
    const rideRef = event.data.after.ref.firestore
      .collection(C.RIDE_REQUESTS)
      .doc(update.rideId);

    try {
      const changed = await event.data.after.ref.firestore.runTransaction(async (tx) => {
        const rideSnap = await tx.get(rideRef);
        if (!rideSnap.exists) return false;
        const ride = rideSnap.data() || {};
        if (
          ride.status !== C.RIDE_STATUS.CANCELLED
          || ride.cancellationNotificationEventId !== update.notificationId
        ) {
          return false;
        }
        tx.set(rideRef, {
          cancellationNotificationStatus: update.status,
          cancellationNotificationAttemptCount: update.attemptCount,
          cancellationNotificationUpdatedAtMs: update.updatedAtMs,
          cancellationNotificationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
      });

      logInfo(context, 'ride.cancellation_notification_status_updated', {
        operation: 'cancellation_notification_status',
        rideId: update.rideId,
        notificationStatus: update.status,
        attemptCount: update.attemptCount,
        result: changed ? 'updated' : 'ignored_stale_reference',
      });
    } catch (error) {
      logWarning(context, 'ride.cancellation_notification_status_failed', {
        operation: 'cancellation_notification_status',
        rideId: update.rideId,
        notificationStatus: update.status,
        errorCode: error?.code || error?.name || 'UPDATE_FAILED',
      });
      throw error;
    }
    return null;
  }
);

module.exports = {
  cancellationDeliveryUpdate,
  cancellationNotificationStatusTrigger,
};