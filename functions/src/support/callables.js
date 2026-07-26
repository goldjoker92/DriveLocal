// @ts-check
// Thin Gen 2 bindings for the minimal support workflow.

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const {
  createSupportTicket,
  listMySupportTickets,
  listAdminSupportTickets,
  updateAdminSupportTicket,
} = require('./tickets');

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

module.exports = {
  createSupportTicketSecure: bind('createSupportTicketSecure', createSupportTicket),
  listMySupportTicketsSecure: bind('listMySupportTicketsSecure', listMySupportTickets),
  listAdminSupportTicketsSecure: bind('listAdminSupportTicketsSecure', listAdminSupportTickets),
  updateAdminSupportTicketSecure: bind('updateAdminSupportTicketSecure', updateAdminSupportTicket),
};