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
const C = require('../rides/constants');

const REGION = 'southamerica-east1';

const syncNotificationTokenSecureFn = onCall(
  { region: REGION },
  withCallableBoundary('syncNotificationTokenSecure', (request, context) =>
    syncNotificationToken({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

// Fires once per created notificationEvents document; idempotent on re-delivery.
const processRideNotificationEventFn = onDocumentCreated(
  { region: REGION, document: `${C.NOTIFICATION_EVENTS}/{eventId}` },
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
      // Never rethrow raw provider errors; log sanitized and let retry policy act.
      logError(context, 'notification.failed', { operation: 'notify', internalMessage: err && err.message });
    }
  }
);

module.exports = {
  syncNotificationTokenSecure: syncNotificationTokenSecureFn,
  processRideNotificationEvent: processRideNotificationEventFn,
};
