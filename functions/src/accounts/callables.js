// @ts-check
// Account deletion bindings: authenticated request callable plus server-only
// Firestore processor. The processor is idempotent and safe to retry.

const { onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { createLoggerContext } = require('../logging/logger');
const { systemClock } = require('../time/clock');
const { requestAccountDeletion } = require('./requestDeletion');
const { processAccountDeletion } = require('./processDeletion');
const { ACCOUNT_DELETION_REQUESTS } = require('./deletionPolicy');

const REGION = 'southamerica-east1';

const requestAccountDeletionSecure = onCall(
  { region: REGION },
  withCallableBoundary('requestAccountDeletionSecure', (request, context) =>
    requestAccountDeletion({
      db: admin.firestore(),
      request,
      context,
      clock: systemClock,
    })
  )
);

const processAccountDeletionRequest = onDocumentCreated(
  { region: REGION, document: `${ACCOUNT_DELETION_REQUESTS}/{requestId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const context = createLoggerContext({
      functionName: 'processAccountDeletionRequest',
      actorType: 'system',
    });
    await processAccountDeletion({
      db: admin.firestore(),
      requestRef: snapshot.ref,
      requestData: snapshot.data() || {},
      context,
      clock: systemClock,
    });
  }
);

module.exports = {
  requestAccountDeletionSecure,
  processAccountDeletionRequest,
};
