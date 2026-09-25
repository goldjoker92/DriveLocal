// @ts-check
// Closed support vocabulary for the Horizonte pilot. Users and admins exchange
// stable codes only: no free text, contact details, addresses or Pix payloads.

const SUPPORT_TICKETS = 'supportTickets';
const MAX_USER_TICKETS = 10;
const MAX_OPEN_TICKETS = 5;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

const STATUS = Object.freeze({
  OPEN: 'open',
  IN_REVIEW: 'in_review',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

const ACTIVE_STATUSES = Object.freeze([STATUS.OPEN, STATUS.IN_REVIEW]);

const CATEGORIES = Object.freeze({
  ride_status_issue: Object.freeze({ roles: ['driver', 'passenger'], requiresRide: true }),
  cancellation_issue: Object.freeze({ roles: ['driver', 'passenger'], requiresRide: true }),
  safety_concern: Object.freeze({ roles: ['driver', 'passenger'], requiresRide: true }),
  fare_payment_issue: Object.freeze({ roles: ['driver', 'passenger'], requiresRide: true }),
  driver_or_vehicle_mismatch: Object.freeze({ roles: ['passenger'], requiresRide: true }),
  passenger_no_show_review: Object.freeze({ roles: ['driver'], requiresRide: true }),
  wallet_topup_issue: Object.freeze({ roles: ['driver'], paymentPurpose: 'wallet_topup' }),
  // A prior charge can still need review; this reads historical records only.
  previous_payment_issue: Object.freeze({ roles: ['driver'], paymentPurpose: 'driver_subscription' }),
  document_review_issue: Object.freeze({ roles: ['driver'] }),
  account_access_issue: Object.freeze({ roles: ['driver', 'passenger'] }),
  technical_error: Object.freeze({ roles: ['driver', 'passenger'] }),
});

const RESOLUTION_CODES = Object.freeze([
  'guidance_provided',
  'payment_under_review',
  'operation_corrected',
  'no_adjustment_required',
  'safety_escalated',
  'duplicate_ticket',
  'resolved_by_system',
]);

const STATUS_TRANSITIONS = Object.freeze({
  [STATUS.OPEN]: Object.freeze([STATUS.IN_REVIEW, STATUS.RESOLVED, STATUS.CLOSED]),
  [STATUS.IN_REVIEW]: Object.freeze([STATUS.OPEN, STATUS.RESOLVED, STATUS.CLOSED]),
  [STATUS.RESOLVED]: Object.freeze([STATUS.CLOSED, STATUS.OPEN]),
  [STATUS.CLOSED]: Object.freeze([STATUS.OPEN]),
});

function categoryDefinition(categoryCode) {
  return CATEGORIES[String(categoryCode || '')] || null;
}

function categoryAllowedForRole(categoryCode, role) {
  const definition = categoryDefinition(categoryCode);
  return Boolean(definition && definition.roles.includes(String(role || '')));
}

function statusTransitionAllowed(fromStatus, toStatus) {
  return Boolean((STATUS_TRANSITIONS[String(fromStatus || '')] || []).includes(String(toStatus || '')));
}

function resolutionRequired(status) {
  return [STATUS.RESOLVED, STATUS.CLOSED].includes(String(status || ''));
}

module.exports = {
  SUPPORT_TICKETS,
  MAX_USER_TICKETS,
  MAX_OPEN_TICKETS,
  DUPLICATE_WINDOW_MS,
  STATUS,
  ACTIVE_STATUSES,
  CATEGORIES,
  RESOLUTION_CODES,
  STATUS_TRANSITIONS,
  categoryDefinition,
  categoryAllowedForRole,
  statusTransitionAllowed,
  resolutionRequired,
};
