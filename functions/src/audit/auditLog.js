// @ts-check
// Append-only audit-log writer for sensitive admin/financial actions.
//   - required fields enforced (fail closed on a missing mandatory field);
//   - before/after summaries pass through deterministic redaction (deep copies —
//     the caller's inputs are never mutated, and no secrets/PII are stored);
//   - the audit entry id is generated server-side;
//   - this helper only APPENDS — it never updates or deletes an audit record;
//   - a failed write is thrown, never silently ignored.
//
// This block does NOT implement admin actions; it provides the writer only.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { AUDIT_LOGS } = require('../config/collections');
const { redactSensitiveData } = require('../logging/logger');

const REQUIRED_FIELDS = ['actorUid', 'actorType', 'action', 'targetType', 'targetId'];

// Actions that MUST carry a human reason (manual/financial overrides).
const REASON_REQUIRED_ACTIONS = new Set([
  'wallet_manual_adjustment',
  'founder_benefit_override',
  'payment_reprocess',
  'dispute_resolution',
]);

/**
 * Appends one immutable audit record and returns its server-generated id.
 * @param {object} db Firestore instance
 * @param {object} entry audit fields
 * @param {{now:()=>number}} clock
 */
async function writeAuditLog(db, entry, clock) {
  const e = entry || {};
  for (const field of REQUIRED_FIELDS) {
    if (e[field] === undefined || e[field] === null || String(e[field]).trim() === '') {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `audit log missing required field: ${field}`,
        safeMetadata: { field },
      });
    }
  }
  if (REASON_REQUIRED_ACTIONS.has(e.action) && (!e.reason || String(e.reason).trim() === '')) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `audit action "${e.action}" requires a reason`,
      safeMetadata: { field: 'reason' },
    });
  }

  const record = {
    actorUid: e.actorUid,
    actorType: e.actorType,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    reason: e.reason ? String(e.reason) : null,
    // Deep-redacted COPIES — inputs are not mutated; secrets/PII never stored.
    beforeSummary: redactSensitiveData(e.beforeSummary != null ? e.beforeSummary : null),
    afterSummary: redactSensitiveData(e.afterSummary != null ? e.afterSummary : null),
    traceId: e.traceId || null,
    createdAtMs: clock.now(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = db.collection(AUDIT_LOGS).doc(); // server-generated id
  await ref.set(record);
  return ref.id;
}

module.exports = { writeAuditLog, REQUIRED_FIELDS, REASON_REQUIRED_ACTIONS };
