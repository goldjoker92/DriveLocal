// @ts-check
// Notification bindings: the syncNotificationTokenSecure callable and the
// processRideNotificationEvent Firestore trigger (onCreate of notificationEvents).
// The trigger sends through real Firebase Admin Messaging.

const { onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { createLoggerContext, logError } = require('../logging/logger');
const { syncNotificationToken } = require('./tokens');
const { processRideNotificationEvent } = require('./processEvent');
const { sendDriverBroadcast } = require('./broadcast');
const {
  publishDriverAnnouncement,
  clearDriverAnnouncement,
} = require('./announcement');
const C = require('../rides/constants');

const REGION = 'southamerica-east1';

const syncNotificationTokenSecureFn = onCall(
  { region: REGION },
  withCallableBoundary('syncNotificationTokenSecure', (request, context) =>
    syncNotificationToken({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

const sendDriverBroadcastSecureFn = onCall(
  { region: REGION },
  withCallableBoundary('sendDriverBroadcastSecure', (request, context) =>
    sendDriverBroadcast({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

const publishDriverAnnouncementSecureFn = onCall(
  { region: REGION },
  withCallableBoundary('publishDriverAnnouncementSecure', (request, context) =>
    publishDriverAnnouncement({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

const clearDriverAnnouncementSecureFn = onCall(
  { region: REGION },
  withCallableBoundary('clearDriverAnnouncementSecure', (request, context) =>
    clearDriverAnnouncement({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

// Fires once per created notificationEvents document. Gen-2 retry is enabled so
// a transient Firebase Messaging/provider failure is delivered again instead of
// being silently lost. processRideNotificationEvent remains idempotent after the
// event reaches a terminal sent/failed state.
const processRideNotificationEventFn = onDocumentCreated(
  {
    region: REGION,
    document: `${C.NOTIFICATION_EVENTS}/{eventId}`,
    retry: true,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const context = createLoggerContext({ functionName: 'processRideNotificationEvent', actorType: 'system' });
    try {
      await processRideNotificationEvent({
        db: admin.firestore(),
        messaging: admin.messaging(),
        eventRef: snap.ref,
        event: snap.data(),
        context,
        clock: systemClock,
      });
    } catch (err) {
      logError(context, 'notification.failed', {
        operation: 'notify',
        internalMessage: err && err.message,
      });
      // Re-throw so Eventarc/Cloud Functions can perform the configured retry.
      throw err;
    }
  }
);

module.exports = {
  syncNotificationTokenSecure: syncNotificationTokenSecureFn,
  sendDriverBroadcastSecure: sendDriverBroadcastSecureFn,
  publishDriverAnnouncementSecure: publishDriverAnnouncementSecureFn,
  clearDriverAnnouncementSecure: clearDriverAnnouncementSecureFn,
  processRideNotificationEvent: processRideNotificationEventFn,
};
