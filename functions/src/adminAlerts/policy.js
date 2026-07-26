// @ts-check
// Closed, privacy-safe vocabulary for the admin incident inbox. Source documents
// may contain sensitive data; descriptors below select only operational codes,
// bounded amounts and non-identity references.

const ADMIN_ALERTS = 'adminAlerts';
const MAX_ADMIN_ALERTS = 200;

const STATUS = Object.freeze({
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
});

const SEVERITY = Object.freeze({
  WARNING: 'warning',
  HIGH: 'high',
  CRITICAL: 'critical',
});

const SOURCE_TYPE = Object.freeze({
  SUPPORT_TICKET: 'support_ticket',
  RIDE_DISPUTE: 'ride_dispute',
  PAYMENT_REVIEW: 'payment_review',
  RISK_CASE: 'risk_case',
  ACCOUNT_DELETION: 'account_deletion',
});

const RESOLUTION_CODES = Object.freeze([
  'action_completed',
  'source_resolved',
  'duplicate_alert',
  'false_positive',
  'reviewed_no_action',
]);

const STATUS_TRANSITIONS = Object.freeze({
  [STATUS.OPEN]: Object.freeze([STATUS.ACKNOWLEDGED, STATUS.IN_PROGRESS, STATUS.RESOLVED]),
  [STATUS.ACKNOWLEDGED]: Object.freeze([STATUS.OPEN, STATUS.IN_PROGRESS, STATUS.RESOLVED]),
  [STATUS.IN_PROGRESS]: Object.freeze([STATUS.OPEN, STATUS.RESOLVED]),
  [STATUS.RESOLVED]: Object.freeze([STATUS.OPEN]),
});

const SUPPORT_FINANCIAL_CATEGORIES = new Set([
  'fare_payment_issue',
  'wallet_topup_issue',
  'subscription_issue',
]);

function normalizedAmount(value) {
  const amount = Number(value || 0);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function descriptorForSupport(data = {}) {
  if (!['open', 'in_review'].includes(data.status)) return null;
  if (data.categoryCode === 'safety_concern') {
    return {
      alertType: 'support_safety_concern',
      severity: SEVERITY.CRITICAL,
      titleCode: 'support_safety_concern',
      actionCode: 'review_support_ticket',
      targetRoute: '/support-tickets',
      targetId: data.ticketId || null,
      reasonCode: data.categoryCode,
      amountCentavos: null,
    };
  }
  if (SUPPORT_FINANCIAL_CATEGORIES.has(data.categoryCode)) {
    return {
      alertType: 'support_financial_issue',
      severity: SEVERITY.HIGH,
      titleCode: 'support_financial_issue',
      actionCode: 'review_support_ticket',
      targetRoute: '/support-tickets',
      targetId: data.ticketId || null,
      reasonCode: data.categoryCode,
      amountCentavos: normalizedAmount(data.contextSnapshot?.payment?.amountCentavos),
    };
  }
  return null;
}

function descriptorForRide(data = {}) {
  if (data.status !== 'disputed') return null;
  return {
    alertType: 'ride_payment_dispute',
    severity: SEVERITY.HIGH,
    titleCode: 'ride_payment_dispute',
    actionCode: 'review_ride_dispute',
    targetRoute: '/ride-disputes',
    targetId: data.rideId || null,
    reasonCode: data.disputeReasonCode || data.paymentIssueReasonCode || 'PAYMENT_DISPUTE_OPENED',
    amountCentavos: normalizedAmount(data.paymentAmountCentavos || data.finalFareCentavos),
  };
}

function descriptorForPayment(data = {}) {
  if (data.status !== 'manual_review') return null;
  return {
    alertType: 'payment_manual_review',
    severity: SEVERITY.HIGH,
    titleCode: 'payment_manual_review',
    actionCode: 'review_payment',
    targetRoute: '/topups-pending',
    targetId: data.paymentRequestId || null,
    reasonCode: data.manualReviewReason || data.reviewReasonCode || 'MANUAL_REVIEW',
    amountCentavos: normalizedAmount(data.amountCentavos),
  };
}

function descriptorForRisk(data = {}) {
  if (!['open', 'under_review'].includes(data.status)) return null;
  if (!['high', 'critical'].includes(data.severity)) return null;
  return {
    alertType: data.severity === 'critical' ? 'risk_case_critical' : 'risk_case_high',
    severity: data.severity === 'critical' ? SEVERITY.CRITICAL : SEVERITY.HIGH,
    titleCode: data.severity === 'critical' ? 'risk_case_critical' : 'risk_case_high',
    actionCode: 'review_risk_case',
    targetRoute: '/antifraud',
    targetId: data.caseId || null,
    reasonCode: data.primaryReasonCode || 'RISK_REVIEW_REQUIRED',
    amountCentavos: normalizedAmount(data.amountAtRiskCentavos),
  };
}

function descriptorForAccountDeletion(data = {}) {
  if (data.status !== 'failed') return null;
  return {
    alertType: 'account_deletion_failed',
    severity: SEVERITY.CRITICAL,
    titleCode: 'account_deletion_failed',
    actionCode: 'review_account_deletion',
    targetRoute: '/dashboard',
    // Request ids may be derived from an identity. Never expose or store them as a
    // navigable target; the deterministic alert id remains enough for correlation.
    targetId: null,
    reasonCode: data.failureCode || 'PROCESSING_FAILED',
    amountCentavos: null,
  };
}

function alertDescriptor(sourceType, data) {
  if (sourceType === SOURCE_TYPE.SUPPORT_TICKET) return descriptorForSupport(data);
  if (sourceType === SOURCE_TYPE.RIDE_DISPUTE) return descriptorForRide(data);
  if (sourceType === SOURCE_TYPE.PAYMENT_REVIEW) return descriptorForPayment(data);
  if (sourceType === SOURCE_TYPE.RISK_CASE) return descriptorForRisk(data);
  if (sourceType === SOURCE_TYPE.ACCOUNT_DELETION) return descriptorForAccountDeletion(data);
  return null;
}

function statusTransitionAllowed(fromStatus, toStatus) {
  return Boolean((STATUS_TRANSITIONS[String(fromStatus || '')] || []).includes(String(toStatus || '')));
}

function resolutionRequired(status) {
  return status === STATUS.RESOLVED;
}

module.exports = {
  ADMIN_ALERTS,
  MAX_ADMIN_ALERTS,
  STATUS,
  SEVERITY,
  SOURCE_TYPE,
  RESOLUTION_CODES,
  STATUS_TRANSITIONS,
  SUPPORT_FINANCIAL_CATEGORIES,
  alertDescriptor,
  statusTransitionAllowed,
  resolutionRequired,
};