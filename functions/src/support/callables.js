// @ts-check
// Thin Gen 2 bindings for the minimal support workflow.

const { onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { createLoggerContext } = require('../logging/logger');
const { systemClock } = require('../time/clock');
const { ACCOUNT_DELETION_REQUESTS } = require('../accounts/deletionPolicy');
const {
  createSupportTicket,
  listMySupportTickets,
  listAdminSupportTickets,
  updateAdminSupportTicket,
} = require('./tickets');
const { pseudonymizeSupportTickets } = require('./accountDeletion');

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

const pseudonymizeSupportTicketsOnAccountDeletion = onDocumentCreated(
  {
    region: REGION,
    document: `${ACCOUNT_DELETION_REQUESTS}/{requestId}`,
    retry: true,
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const context = createLoggerContext({
      functionName: 'pseudonymizeSupportTicketsOnAccountDeletion',
      actorType: 'system',
    });
    await pseudonymizeSupportTickets({
      db: admin.firestore(),
      requestData: snapshot.data() || {},
      context,
    });
  }
);

module.exports = {
  createSupportTicketSecure: bind('createSupportTicketSecure', createSupportTicket),
  listMySupportTicketsSecure: bind('listMySupportTicketsSecure', listMySupportTickets),
  listAdminSupportTicketsSecure: bind('listAdminSupportTicketsSecure', listAdminSupportTickets),
  updateAdminSupportTicketSecure: bind('updateAdminSupportTicketSecure', updateAdminSupportTicket),
  pseudonymizeSupportTicketsOnAccountDeletion,
};