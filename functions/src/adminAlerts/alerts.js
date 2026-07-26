// @ts-check
// Aggregated admin incident inbox. Source identity is converted to a deterministic
// hash and only explicit operational fields enter the alert document.

const crypto = require('crypto');
const admin = require('firebase-admin');

const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateEnum,
  validateIdentifier,
  validateIdempotencyKey,
} = require('../validation/validators');
const { requireAdmin } = require('../auth/adminAuth');
const { writeAuditLog } = require('../audit/auditLog');
const { logInfo, logWarning, shortHash } = require('../logging/logger');
const {
  ADMIN_ALERTS,
  MAX_ADMIN_ALERTS,
  STATUS,
  SEVERITY,
  RESOLUTION_CODES,
  alertDescriptor,
  statusTransitionAllowed,
  resolutionRequired,
} = require('./policy');

function nowTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function hash(value, length = 28) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function safeReasonCode(value, fallback = 'REVIEW_REQUIRED') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:/-]/g, '_')
    .slice(0, 100);
  return normalized || fallback;
}

function alertDocumentId(sourceType, sourceId) {
  return `aa_${hash(`${sourceType}:${sourceId}`)}`;
}

function descriptorFingerprint(descriptor, sourceStatus) {
  return hash(JSON.stringify({
    alertType: descriptor?.alertType || null,
    severity: descriptor?.severity || null,
    reasonCode: descriptor?.reasonCode || null,
    amountCentavos: descriptor?.amountCentavos || null,
    targetId: descriptor?.targetId || null,
    sourceStatus: sourceStatus || null,
  }), 32);
}

function safeAlertProjection(document) {
  const data = document?.data ? document.data() || {} : document || {};
  return {
    alertId: document?.id || data.alertId,
    alertType: data.alertType || null,
    severity: data.severity || SEVERITY.WARNING,
    status: data.status || STATUS.OPEN,
    titleCode: data.titleCode || null,
    actionCode: data.actionCode || null,
    sourceType: data.sourceType || null,
    sourceRefHash: data.sourceRefHash || null,
    sourceStatus: data.sourceStatus || null,
    targetRoute: data.targetRoute || null,
    targetId: data.targetId || null,
    reasonCode: data.reasonCode || null,
    amountCentavos: Number.isSafeInteger(data.amountCentavos) ? data.amountCentavos : null,
    occurrenceCount: Number(data.occurrenceCount || 0),
    firstDetectedAtMs: Number(data.firstDetectedAtMs || 0),
    lastDetectedAtMs: Number(data.lastDetectedAtMs || 0),
    updatedAtMs: Number(data.updatedAtMs || 0),
    resolutionCode: data.resolutionCode || null,
    acknowledgedAtMs: Number(data.acknowledgedAtMs || 0) || null,
    resolvedAtMs: Number(data.resolvedAtMs || 0) || null,
  };
}

async function syncAdminAlert({ db, sourceType, sourceId, sourceData, context, clock }) {
  const alertId = alertDocumentId(sourceType, sourceId);
  const alertRef = db.collection(ADMIN_ALERTS).doc(alertId);
  const descriptor = alertDescriptor(sourceType, sourceData || {});
  const nowMs = Number(clock.now());
  const sourceStatus = sourceData?.status || null;

  const result = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(alertRef);
    const before = snapshot.exists ? snapshot.data() || {} : null;

    if (!descriptor) {
      if (!before || before.sourceActive === false) {
        return { action: 'noop', alertId, before };
      }
      if (before.status === STATUS.RESOLVED) {
        const update = {
          sourceActive: false,
          sourceStatus,
          updatedAtMs: nowMs,
          updatedAt: nowTimestamp(),
        };
        tx.set(alertRef, update, { merge: true });
        return {
          action: 'source_inactive',
          alertId,
          before,
          after: { ...before, ...update },
        };
      }
      const update = {
        status: STATUS.RESOLVED,
        resolutionCode: 'source_resolved',
        sourceActive: false,
        sourceStatus,
        resolvedBy: 'system',
        resolvedAtMs: nowMs,
        resolvedAt: nowTimestamp(),
        updatedAtMs: nowMs,
        updatedAt: nowTimestamp(),
      };
      tx.set(alertRef, update, { merge: true });
      return { action: 'resolved', alertId, before, after: { ...before, ...update } };
    }

    const fingerprint = descriptorFingerprint(descriptor, sourceStatus);
    if (before && before.sourceActive === true && before.sourceFingerprint === fingerprint) {
      return { action: 'noop', alertId, before };
    }

    const reopened = Boolean(before && before.status === STATUS.RESOLVED);
    const record = {
      alertId,
      alertType: descriptor.alertType,
      severity: descriptor.severity,
      status: reopened || !before ? STATUS.OPEN : before.status,
      titleCode: descriptor.titleCode,
      actionCode: descriptor.actionCode,
      sourceType,
      sourceRefHash: shortHash(`${sourceType}:${sourceId}`),
      sourceStatus,
      sourceActive: true,
      sourceFingerprint: fingerprint,
      targetRoute: descriptor.targetRoute,
      targetId: descriptor.targetId,
      reasonCode: safeReasonCode(descriptor.reasonCode),
      amountCentavos: descriptor.amountCentavos,
      occurrenceCount: Number(before?.occurrenceCount || 0) + 1,
      firstDetectedAtMs: Number(before?.firstDetectedAtMs || 0) || nowMs,
      firstDetectedAt: before?.firstDetectedAt || nowTimestamp(),
      lastDetectedAtMs: nowMs,
      lastDetectedAt: nowTimestamp(),
      updatedAtMs: nowMs,
      updatedAt: nowTimestamp(),
      resolutionCode: reopened ? null : before?.resolutionCode || null,
      acknowledgedAtMs: reopened ? null : before?.acknowledgedAtMs || null,
      acknowledgedAt: reopened ? null : before?.acknowledgedAt || null,
      resolvedAtMs: reopened ? null : before?.resolvedAtMs || null,
      resolvedAt: reopened ? null : before?.resolvedAt || null,
      resolvedBy: reopened ? null : before?.resolvedBy || null,
    };
    if (!before) {
      record.createdAtMs = nowMs;
      record.createdAt = nowTimestamp();
    }
    tx.set(alertRef, record, { merge: true });
    return {
      action: reopened ? 'reopened' : before ? 'updated' : 'created',
      alertId,
      before,
      after: { ...(before || {}), ...record },
    };
  });

  if (result.action !== 'noop') {
    logInfo(context, `admin_alert.${result.action}`, {
      operation: 'sync_admin_alert',
      alertId,
      sourceType,
      alertType: descriptor?.alertType || result.before?.alertType || null,
      severity: descriptor?.severity || result.before?.severity || null,
      result: result.action,
    });
  }
  return result;
}

function listArgs(request) {
  const payload = assertShape(request?.data || {}, {
    optional: ['status', 'severity', 'limit'],
  });
  const status = payload.status == null
    ? STATUS.OPEN
    : validateEnum(payload.status, ['all', ...Object.values(STATUS)], 'status');
  const severity = payload.severity == null
    ? 'all'
    : validateEnum(payload.severity, ['all', ...Object.values(SEVERITY)], 'severity');
  const requestedLimit = Number(payload.limit == null ? 50 : payload.limit);
  return {
    status,
    severity,
    limit: Number.isSafeInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_ADMIN_ALERTS)
      : 50,
  };
}

async function listAdminAlerts({ db, request, context }) {
  const adminUid = await requireAdmin(db, request);
  const args = listArgs(request);
  let query = db.collection(ADMIN_ALERTS);
  if (args.status !== 'all') query = query.where('status', '==', args.status);
  if (args.severity !== 'all') query = query.where('severity', '==', args.severity);
  const snapshot = await query.orderBy('updatedAtMs', 'desc').limit(args.limit).get();
  const alerts = snapshot.docs.map(safeAlertProjection);
  logInfo(context, 'admin_alert.listed', {
    operation: 'list_admin_alerts',
    adminIdHash: shortHash(adminUid),
    status: args.status,
    severity: args.severity,
    alertCount: alerts.length,
  });
  return { alerts, status: args.status, severity: args.severity };
}

function updateArgs(request) {
  const payload = assertShape(request?.data, {
    required: ['alertId', 'status', 'idempotencyKey'],
    optional: ['resolutionCode'],
  });
  const status = validateEnum(payload.status, Object.values(STATUS), 'status');
  const resolutionCode = payload.resolutionCode == null
    ? null
    : validateEnum(payload.resolutionCode, RESOLUTION_CODES, 'resolutionCode');
  if (resolutionRequired(status) && !resolutionCode) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'resolved admin alert requires resolution code',
      safeMetadata: { field: 'resolutionCode' },
    });
  }
  if (!resolutionRequired(status) && resolutionCode) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'active admin alert cannot carry resolution code',
      safeMetadata: { field: 'resolutionCode' },
    });
  }
  return {
    alertId: validateIdentifier(payload.alertId, 'alertId'),
    status,
    resolutionCode,
    idempotencyKey: validateIdempotencyKey(payload.idempotencyKey),
  };
}

async function updateAdminAlert({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const args = updateArgs(request);
  const nowMs = Number(clock.now());
  const alertRef = db.collection(ADMIN_ALERTS).doc(args.alertId);
  const operationHash = hash(`${adminUid}:${args.idempotencyKey}`, 24);

  const result = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(alertRef);
    if (!snapshot.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: 'admin alert not found',
        safeMetadata: { field: 'alertId' },
      });
    }
    const before = snapshot.data() || {};
    if (before.lastAdminOperationHash === operationHash) {
      if (before.status !== args.status || (before.resolutionCode || null) !== args.resolutionCode) {
        throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          internalMessage: 'admin alert idempotency key reused for another update',
        });
      }
      return { replay: true, before, after: before };
    }
    if (before.status === args.status && (before.resolutionCode || null) === args.resolutionCode) {
      return { replay: true, before, after: before };
    }
    if (!statusTransitionAllowed(before.status, args.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'unsupported admin alert status transition',
        safeMetadata: { fromStatus: before.status, toStatus: args.status },
      });
    }

    const reopening = args.status === STATUS.OPEN;
    const acknowledging = [STATUS.ACKNOWLEDGED, STATUS.IN_PROGRESS].includes(args.status);
    const update = {
      status: args.status,
      resolutionCode: args.resolutionCode,
      lastAdminOperationHash: operationHash,
      updatedAtMs: nowMs,
      updatedAt: nowTimestamp(),
      lastAdminActionAtMs: nowMs,
      lastAdminActionAt: nowTimestamp(),
      acknowledgedAtMs: reopening
        ? null
        : before.acknowledgedAtMs || (acknowledging ? nowMs : null),
      acknowledgedAt: reopening
        ? null
        : before.acknowledgedAt || (acknowledging ? nowTimestamp() : null),
      resolvedAtMs: args.status === STATUS.RESOLVED ? nowMs : null,
      resolvedAt: args.status === STATUS.RESOLVED ? nowTimestamp() : null,
      resolvedBy: args.status === STATUS.RESOLVED ? 'admin' : null,
    };
    tx.set(alertRef, update, { merge: true });
    return { replay: false, before, after: { ...before, ...update } };
  });

  if (!result.replay) {
    try {
      await writeAuditLog(db, {
        actorUid: adminUid,
        actorType: 'admin',
        action: 'admin_alert_status_changed',
        targetType: 'admin_alert',
        targetId: args.alertId,
        traceId: context?.traceId,
        beforeSummary: {
          status: result.before.status,
          severity: result.before.severity,
          alertType: result.before.alertType,
        },
        afterSummary: {
          status: args.status,
          resolutionCode: args.resolutionCode,
        },
      }, clock);
    } catch (auditError) {
      logWarning(context, 'admin_alert.audit_failed', {
        operation: 'update_admin_alert',
        alertId: args.alertId,
        errorCode: auditError?.code || auditError?.name || 'AUDIT_WRITE_FAILED',
      });
    }
  }

  logInfo(context, result.replay ? 'admin_alert.status_replayed' : 'admin_alert.status_changed', {
    operation: 'update_admin_alert',
    alertId: args.alertId,
    fromStatus: result.before.status,
    toStatus: args.status,
    resolutionCode: args.resolutionCode,
  });
  return {
    alert: safeAlertProjection({ id: args.alertId, data: () => result.after }),
    replay: result.replay,
  };
}

module.exports = {
  alertDocumentId,
  descriptorFingerprint,
  safeReasonCode,
  safeAlertProjection,
  syncAdminAlert,
  listAdminAlerts,
  updateAdminAlert,
};
