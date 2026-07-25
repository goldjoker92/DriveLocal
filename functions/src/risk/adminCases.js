// @ts-check
// Admin-only antifraud case workflow. Decisions are explicit, auditable and
// idempotent. Permanent blocks happen only after an authenticated admin chooses
// fraud_confirmed; automated detectors can only open review cases.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateIdentifier,
  validateEnum,
  validateNonEmptyString,
  validateIdempotencyKey,
} = require('../validation/validators');
const { requireAdmin } = require('../auth/adminAuth');
const { writeAuditLog } = require('../audit/auditLog');
const { logInfo, shortHash } = require('../logging/logger');
const C = require('./constants');

const CASE_OUTCOMES = Object.freeze([
  'mark_under_review',
  'close_no_evidence',
  'warning_recorded',
  'temporary_restriction',
  'fraud_confirmed',
]);
const CASE_STATUSES = Object.freeze([
  'open',
  'under_review',
  'resolved',
  'closed_no_evidence',
  'fraud_confirmed',
  'all',
]);
const MAX_CASES = 200;
const MAX_RESTRICTION_HOURS = 24 * 30;

function safeCase(document) {
  const data = document.data ? document.data() || {} : document || {};
  return {
    caseId: document.id || data.caseId,
    actorType: data.actorType || null,
    actorId: data.actorId || null,
    primaryReasonCode: data.primaryReasonCode || null,
    severity: data.severity || C.SEVERITY.LOW,
    recommendedAction: data.recommendedAction || C.ACTION.LOG_ONLY,
    sourceType: data.sourceType || null,
    sourceId: data.sourceId || null,
    linkedEventCount: Array.isArray(data.linkedEventIds) ? data.linkedEventIds.length : 0,
    status: data.status || 'open',
    openedAtMs: Number(data.openedAtMs || 0),
    updatedAtMs: Number(data.updatedAtMs || data.openedAtMs || 0),
    decision: data.decision
      ? {
          outcome: data.decision.outcome || null,
          reasonCode: data.decision.reasonCode || null,
          note: data.decision.note || null,
          decidedAtMs: Number(data.decision.decidedAtMs || 0),
          restrictionUntilMs: Number(data.decision.restrictionUntilMs || 0) || null,
        }
      : null,
  };
}

async function listAdminRiskCases({ db, request, context }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data || {}, { optional: ['status', 'limit'] });
  const status = payload.status == null
    ? 'open'
    : validateEnum(payload.status, CASE_STATUSES, 'status');
  const requestedLimit = payload.limit == null ? 100 : Number(payload.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_CASES) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `invalid risk case limit: ${payload.limit}`,
      safeMetadata: { field: 'limit' },
    });
  }

  // Bounded read + in-memory filter avoids launch-time composite-index coupling.
  // At city scale this remains cheap; a materialized queue can replace it later.
  const snapshot = await db.collection(C.COLLECTIONS.FRAUD_CASES).limit(MAX_CASES).get();
  const cases = snapshot.docs
    .map(safeCase)
    .filter((entry) => status === 'all' || entry.status === status)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, requestedLimit);

  logInfo(context, 'admin.risk_cases.listed', {
    operation: 'list_risk_cases',
    adminIdHash: shortHash(adminUid),
    result: status,
    count: cases.length,
  });
  return { cases, truncated: snapshot.size >= MAX_CASES };
}

function profileCollection(actorType) {
  if (actorType === C.ACTOR_TYPE.DRIVER) return 'drivers';
  if (actorType === C.ACTOR_TYPE.PASSENGER) return 'passengers';
  return null;
}

function decisionStatus(outcome) {
  if (outcome === 'mark_under_review') return 'under_review';
  if (outcome === 'close_no_evidence') return 'closed_no_evidence';
  if (outcome === 'fraud_confirmed') return 'fraud_confirmed';
  return 'resolved';
}

async function decideAdminRiskCase({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data || {}, {
    required: ['caseId', 'outcome', 'reasonCode', 'idempotencyKey'],
    optional: ['note', 'restrictionHours'],
  });
  const caseId = validateIdentifier(payload.caseId, 'caseId');
  const outcome = validateEnum(payload.outcome, CASE_OUTCOMES, 'outcome');
  const reasonCode = validateNonEmptyString(payload.reasonCode, 'reasonCode').slice(0, 80);
  const note = payload.note == null
    ? null
    : validateNonEmptyString(payload.note, 'note').slice(0, 500);
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey);
  const restrictionHours = payload.restrictionHours == null
    ? 24
    : Number(payload.restrictionHours);
  if (
    outcome === 'temporary_restriction'
    && (!Number.isInteger(restrictionHours)
      || restrictionHours < 1
      || restrictionHours > MAX_RESTRICTION_HOURS)
  ) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `invalid restriction hours: ${payload.restrictionHours}`,
      safeMetadata: { field: 'restrictionHours' },
    });
  }

  const caseRef = db.collection(C.COLLECTIONS.FRAUD_CASES).doc(caseId);
  const nowMs = Number(clock.now());
  const outcomeResult = await db.runTransaction(async (tx) => {
    const caseSnap = await tx.get(caseRef);
    if (!caseSnap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `risk case not found: ${caseId}`,
        safeMetadata: { field: 'caseId' },
      });
    }
    const before = caseSnap.data() || {};
    if (before.decision?.idempotencyKey === idempotencyKey) {
      return { replay: true, before, after: before };
    }
    if (
      before.status === 'fraud_confirmed'
      && outcome !== 'fraud_confirmed'
    ) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `confirmed fraud case ${caseId} cannot be silently downgraded`,
        safeMetadata: { reason: 'CONFIRMED_FRAUD_REQUIRES_SEPARATE_UNBLOCK_REVIEW' },
      });
    }

    const collection = profileCollection(before.actorType);
    const profileRef = collection && before.actorId
      ? db.collection(collection).doc(before.actorId)
      : null;
    const profileSnap = profileRef ? await tx.get(profileRef) : null;
    const profile = profileSnap?.exists ? profileSnap.data() || {} : {};
    const restrictionUntilMs = outcome === 'temporary_restriction'
      ? nowMs + restrictionHours * 60 * 60 * 1000
      : null;

    if (profileRef) {
      const profileUpdate = {
        lastRiskDecisionCaseId: caseId,
        lastRiskDecisionReasonCode: reasonCode,
        lastRiskDecisionAtMs: nowMs,
        lastRiskDecisionAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (outcome === 'warning_recorded') {
        profileUpdate.riskWarningCount = Number(profile.riskWarningCount || 0) + 1;
      } else if (outcome === 'temporary_restriction') {
        profileUpdate.riskRestrictionCaseId = caseId;
        profileUpdate.riskRestrictionUntilMs = restrictionUntilMs;
        profileUpdate.riskRestrictionUntil = new Date(restrictionUntilMs);
        if (before.actorType === C.ACTOR_TYPE.DRIVER) {
          profileUpdate.riskBlockedFromNewAcceptances = true;
        } else if (before.actorType === C.ACTOR_TYPE.PASSENGER) {
          profileUpdate.riskBlockedFromNewRides = true;
        }
      } else if (outcome === 'fraud_confirmed') {
        profileUpdate.isBlocked = true;
        profileUpdate.riskBlockCaseId = caseId;
        profileUpdate.riskBlockReasonCode = reasonCode;
        profileUpdate.riskBlockedAtMs = nowMs;
        profileUpdate.riskBlockedAt = admin.firestore.FieldValue.serverTimestamp();
        if (before.actorType === C.ACTOR_TYPE.DRIVER) {
          profileUpdate.riskBlockedFromNewAcceptances = true;
          profileUpdate.availabilityStatus = 'offline';
        } else if (before.actorType === C.ACTOR_TYPE.PASSENGER) {
          profileUpdate.riskBlockedFromNewRides = true;
        }
      } else if (outcome === 'close_no_evidence') {
        // Clear only restrictions created by this exact case. Another open case or
        // a manually confirmed block must not be accidentally removed.
        if (profile.riskRestrictionCaseId === caseId) {
          profileUpdate.riskRestrictionCaseId = null;
          profileUpdate.riskRestrictionUntilMs = null;
          profileUpdate.riskRestrictionUntil = null;
          if (before.actorType === C.ACTOR_TYPE.DRIVER) {
            profileUpdate.riskBlockedFromNewAcceptances = false;
          } else if (before.actorType === C.ACTOR_TYPE.PASSENGER) {
            profileUpdate.riskBlockedFromNewRides = false;
          }
        }
      }
      tx.set(profileRef, profileUpdate, { merge: true });
    }

    const status = decisionStatus(outcome);
    const decision = {
      outcome,
      reasonCode,
      note,
      restrictionHours: outcome === 'temporary_restriction' ? restrictionHours : null,
      restrictionUntilMs,
      decidedByAdmin: adminUid,
      decidedAtMs: nowMs,
      idempotencyKey,
    };
    const after = {
      ...before,
      status,
      decision,
      updatedAtMs: nowMs,
    };
    tx.set(caseRef, {
      status,
      decision,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolvedAtMs: outcome === 'mark_under_review' ? null : nowMs,
      resolvedAt: outcome === 'mark_under_review'
        ? null
        : admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const riskProfileId = before.actorType && before.actorId
      ? `${before.actorType}_${before.actorId}`
      : null;
    if (riskProfileId) {
      tx.set(db.collection(C.COLLECTIONS.RISK_PROFILES).doc(riskProfileId), {
        lastCaseId: caseId,
        lastCaseStatus: status,
        lastDecisionReasonCode: reasonCode,
        lastDecisionAtMs: nowMs,
        lastDecisionAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return { replay: false, before, after };
  });

  if (!outcomeResult.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'risk_case_decided',
      targetType: 'risk_case',
      targetId: caseId,
      reason: reasonCode,
      traceId: context?.traceId,
      beforeSummary: {
        status: outcomeResult.before.status || null,
        severity: outcomeResult.before.severity || null,
        actorType: outcomeResult.before.actorType || null,
      },
      afterSummary: {
        status: outcomeResult.after.status,
        outcome,
        restrictionHours: outcome === 'temporary_restriction' ? restrictionHours : null,
      },
    }, clock);
    logInfo(context, 'admin.risk_case_decided', {
      operation: 'decide_risk_case',
      adminIdHash: shortHash(adminUid),
      reasonCode,
      result: outcome,
    });
  }

  return {
    case: safeCase({ id: caseId, data: () => outcomeResult.after }),
    replay: outcomeResult.replay,
  };
}

module.exports = {
  CASE_OUTCOMES,
  CASE_STATUSES,
  MAX_CASES,
  MAX_RESTRICTION_HOURS,
  safeCase,
  listAdminRiskCases,
  decideAdminRiskCase,
};
