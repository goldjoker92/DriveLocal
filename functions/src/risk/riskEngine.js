// @ts-check
// Append-only, privacy-safe risk event engine. Callers may use the transaction
// variant so the business mutation and its fraud signal commit atomically.
// Deterministic event ids make scheduled scans and network retries idempotent:
// the same logical signal never increments a profile twice.

const admin = require('firebase-admin');
const { createHash } = require('crypto');
const { logInfo, logWarning, shortHash } = require('../logging/logger');
const C = require('./constants');

const SAFE_METADATA_KEYS = new Set([
  'rideStatus',
  'vehicleType',
  'serviceAreaId',
  'amountCentavos',
  'holdCentavos',
  'capturedCentavos',
  'releasedCentavos',
  'count',
  'windowDays',
  'ageMs',
  'distanceMeters',
  'speedKph',
  'paymentState',
  'cancelledBy',
  'promotionId',
  'policyVersion',
  'source',
  'result',
]);

function stableId(parts) {
  return createHash('sha256')
    .update(parts.filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 32);
}

function sanitizeMetadata(metadata = {}) {
  const safe = {};
  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (!SAFE_METADATA_KEYS.has(key) || value == null) return;
    if (typeof value === 'string') safe[key] = value.slice(0, 80);
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === 'boolean') safe[key] = value;
  });
  return safe;
}

function profileId(actorType, actorId) {
  return `${actorType}_${actorId}`;
}

function eventId({ actorType, actorId, reasonCode, sourceType, sourceId, eventKey }) {
  return stableId([eventKey || '', actorType, actorId, reasonCode, sourceType, sourceId]);
}

function caseId({ actorType, actorId, reasonCode, sourceType, sourceId }) {
  return `case_${stableId([actorType, actorId, reasonCode, sourceType, sourceId])}`;
}

function shouldOpenCase(severity, action) {
  return severity === C.SEVERITY.HIGH
    || severity === C.SEVERITY.CRITICAL
    || action === C.ACTION.REQUIRE_REVIEW
    || action === C.ACTION.FREEZE_SETTLEMENT
    || action === C.ACTION.TEMPORARY_RESTRICTION;
}

async function writeRiskSignalTx({
  tx,
  db,
  clock,
  context,
  actorType,
  actorId,
  reasonCode,
  severity = C.SEVERITY.LOW,
  recommendedAction = C.ACTION.LOG_ONLY,
  sourceType,
  sourceId,
  eventKey,
  metadata = {},
}) {
  if (!tx || !db || !actorType || !actorId || !reasonCode || !sourceType || !sourceId) {
    throw new Error('writeRiskSignalTx: required risk signal fields are missing');
  }

  const nowMs = Number(clock?.now?.() || Date.now());
  const id = eventId({ actorType, actorId, reasonCode, sourceType, sourceId, eventKey });
  const eventRef = db.collection(C.COLLECTIONS.RISK_EVENTS).doc(id);
  const eventSnap = await tx.get(eventRef);
  if (eventSnap.exists) {
    return {
      eventId: id,
      safeMetadata: sanitizeMetadata(metadata),
      duplicate: true,
    };
  }

  const profileRef = db.collection(C.COLLECTIONS.RISK_PROFILES).doc(profileId(actorType, actorId));
  const safeMetadata = sanitizeMetadata(metadata);

  tx.set(eventRef, {
    eventId: id,
    actorType,
    actorId,
    reasonCode,
    severity,
    recommendedAction,
    sourceType,
    sourceId,
    ruleVersion: C.RULE_VERSION,
    metadata: safeMetadata,
    traceId: context?.traceId || null,
    status: 'open',
    occurredAtMs: nowMs,
    occurredAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  tx.set(profileRef, {
    actorType,
    actorId,
    totalSignals: admin.firestore.FieldValue.increment(1),
    openSignals: admin.firestore.FieldValue.increment(1),
    lastReasonCode: reasonCode,
    lastSeverity: severity,
    lastSignalAtMs: nowMs,
    lastSignalAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  if (shouldOpenCase(severity, recommendedAction)) {
    const idForCase = caseId({ actorType, actorId, reasonCode, sourceType, sourceId });
    tx.set(db.collection(C.COLLECTIONS.FRAUD_CASES).doc(idForCase), {
      caseId: idForCase,
      actorType,
      actorId,
      primaryReasonCode: reasonCode,
      severity,
      recommendedAction,
      sourceType,
      sourceId,
      linkedEventIds: admin.firestore.FieldValue.arrayUnion(id),
      status: 'open',
      ruleVersion: C.RULE_VERSION,
      openedAtMs: nowMs,
      openedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return { eventId: id, safeMetadata, duplicate: false };
}

async function writeRiskSignal(args) {
  const result = await args.db.runTransaction((tx) => writeRiskSignalTx({ ...args, tx }));
  logInfo(args.context, result.duplicate ? 'risk.signal.duplicate_ignored' : 'risk.signal.created', {
    operation: 'risk_signal',
    reasonCode: args.reasonCode,
    result: result.duplicate ? 'duplicate_ignored' : (args.recommendedAction || C.ACTION.LOG_ONLY),
    targetUserIdHash: shortHash(args.actorId),
  });
  return result;
}

async function bestEffortRiskSignal(args) {
  try {
    return await writeRiskSignal(args);
  } catch (error) {
    logWarning(args.context, 'risk.signal.failed', {
      operation: 'risk_signal',
      reasonCode: args.reasonCode,
      internalMessage: error?.message,
    });
    return null;
  }
}

module.exports = {
  SAFE_METADATA_KEYS,
  sanitizeMetadata,
  stableId,
  profileId,
  eventId,
  caseId,
  writeRiskSignalTx,
  writeRiskSignal,
  bestEffortRiskSignal,
};
