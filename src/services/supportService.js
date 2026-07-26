// Client entry point for user support. All writes and reads go through authenticated
// callables; the app never reads the private supportTickets collection directly.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

function idempotencyKey() {
  const random = Math.random().toString(36).slice(2, 12);
  return `support-${random}${random}`.slice(0, 40);
}

function trace(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[SUPPORT] ${event}`, {
    scope: 'support_ticket',
    event,
    atMs: Date.now(),
    ...details,
  });
}

export async function createSupportTicket({ categoryCode, rideId = null, sourceRoute = 'unknown' }) {
  const startedAt = Date.now();
  trace('ticket.create_requested', {
    categoryCode,
    hasRideContext: Boolean(rideId),
    sourceRoute,
  });
  try {
    const result = await httpsCallable(functions, 'createSupportTicketSecure')({
      categoryCode,
      idempotencyKey: idempotencyKey(),
      ...(rideId ? { rideId } : {}),
      sourceRoute,
    });
    trace('ticket.create_succeeded', {
      ticketId: result.data?.ticketId || null,
      categoryCode,
      status: result.data?.status || null,
      replay: result.data?.replay === true,
      duplicate: result.data?.duplicate === true,
      durationMs: Date.now() - startedAt,
    });
    return result.data;
  } catch (error) {
    trace('ticket.create_failed', {
      categoryCode,
      reason: error?.code || error?.name || 'unknown',
      durationMs: Date.now() - startedAt,
    }, 'warn');
    throw error;
  }
}

export async function listMySupportTickets() {
  const startedAt = Date.now();
  trace('tickets.list_requested');
  try {
    const result = await httpsCallable(functions, 'listMySupportTicketsSecure')({});
    trace('tickets.list_succeeded', {
      actorRole: result.data?.actorRole || null,
      ticketCount: result.data?.tickets?.length || 0,
      durationMs: Date.now() - startedAt,
    });
    return result.data || { actorRole: null, tickets: [] };
  } catch (error) {
    trace('tickets.list_failed', {
      reason: error?.code || error?.name || 'unknown',
      durationMs: Date.now() - startedAt,
    }, 'warn');
    throw error;
  }
}