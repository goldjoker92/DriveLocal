// @ts-check
// Gen 2 bindings for the admin incident inbox. Each source has an independent
// retryable trigger so one broken domain cannot stop the others.

const { onCall } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { createLoggerContext, logError } = require('../logging/logger');
const { systemClock } = require('../time/clock');
const { ACCOUNT_DELETION_REQUESTS } = require('../accounts/deletionPolicy');
const riskC = require('../risk/constants');
const paymentC = require('../payments/constants');
const rideC = require('../rides/constants');
const { SUPPORT_TICKETS } = require('../support/policy');
const { SOURCE_TYPE } = require('./policy');
const { syncAdminAlert, listAdminAlerts, updateAdminAlert } = require('./alerts');

const REGION = 'southamerica-east1';

function bind(name, handler) {
  return onCall(
    { region: REGION },
    withCallableBoundary(name, (request, context) => handler({
      db: admin.firestore(),
      request,
      context,
      clock: systemClock,
    }))
  );
}

function dataWithDocumentId(sourceType, sourceId, snapshot) {
  const data = snapshot?.exists ? snapshot.data() || {} : {};
  if (sourceType === SOURCE_TYPE.SUPPORT_TICKET) return { ...data, ticketId: sourceId };
  if (sourceType === SOURCE_TYPE.RIDE_DISPUTE) return { ...data, rideId: sourceId };
  if (sourceType === SOURCE_TYPE.PAYMENT_REVIEW) return { ...data, paymentRequestId: sourceId };
  if (sourceType === SOURCE_TYPE.RISK_CASE) return { ...data, caseId: sourceId };
  return data;
}

function bindSourceTrigger(functionName, document, sourceType) {
  return onDocumentWritten(
    {
      region: REGION,
      document,
      retry: true,
      timeoutSeconds: 120,
      memory: '256MiB',
    },
    async (event) => {
      const sourceId = String(event.params?.sourceId || '');
      if (!sourceId) return;
      const context = createLoggerContext({
        functionName,
        actorType: 'system',
      });
      try {
        await syncAdminAlert({
          db: admin.firestore(),
          sourceType,
          sourceId,
          sourceData: dataWithDocumentId(sourceType, sourceId, event.data?.after),
          context,
          clock: systemClock,
        });
      } catch (error) {
        logError(context, 'admin_alert.source_sync_failed', {
          sourceType,
          sourceRefHash: require('../logging/logger').shortHash(`${sourceType}:${sourceId}`),
          errorCode: error?.code || error?.name || 'SOURCE_SYNC_FAILED',
        });
        throw error;
      }
    }
  );
}

const supportTicketAdminAlertTrigger = bindSourceTrigger(
  'supportTicketAdminAlertTrigger',
  `${SUPPORT_TICKETS}/{sourceId}`,
  SOURCE_TYPE.SUPPORT_TICKET
);

const rideDisputeAdminAlertTrigger = bindSourceTrigger(
  'rideDisputeAdminAlertTrigger',
  `${rideC.RIDE_REQUESTS}/{sourceId}`,
  SOURCE_TYPE.RIDE_DISPUTE
);

const paymentReviewAdminAlertTrigger = bindSourceTrigger(
  'paymentReviewAdminAlertTrigger',
  `${paymentC.PAYMENT_REQUESTS}/{sourceId}`,
  SOURCE_TYPE.PAYMENT_REVIEW
);

const riskCaseAdminAlertTrigger = bindSourceTrigger(
  'riskCaseAdminAlertTrigger',
  `${riskC.COLLECTIONS.FRAUD_CASES}/{sourceId}`,
  SOURCE_TYPE.RISK_CASE
);

const accountDeletionAdminAlertTrigger = bindSourceTrigger(
  'accountDeletionAdminAlertTrigger',
  `${ACCOUNT_DELETION_REQUESTS}/{sourceId}`,
  SOURCE_TYPE.ACCOUNT_DELETION
);

module.exports = {
  listAdminAlertsSecure: bind('listAdminAlertsSecure', listAdminAlerts),
  updateAdminAlertSecure: bind('updateAdminAlertSecure', updateAdminAlert),
  supportTicketAdminAlertTrigger,
  rideDisputeAdminAlertTrigger,
  paymentReviewAdminAlertTrigger,
  riskCaseAdminAlertTrigger,
  accountDeletionAdminAlertTrigger,
  dataWithDocumentId,
};