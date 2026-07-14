// @ts-check
// Idempotency foundation for future financial operations (wallet top-ups,
// Mercado Pago orders, commission settlement). This block ships the generic
// primitives only — NO wallet or Mercado Pago logic.
//
// Guarantees:
//   - same key + same payload fingerprint + completed -> safe replay of result;
//   - same key + conflicting fingerprint -> IDEMPOTENCY_CONFLICT;
//   - acquisition runs inside a Firestore transaction (concurrency-safe);
//   - the fingerprint source NEVER includes secrets or volatile fields;
//   - the fingerprint is deterministic and property-order independent.

const { createHash } = require('crypto');
const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { IDEMPOTENCY_OPERATIONS } = require('../config/collections');

const OPERATION_STATES = Object.freeze({
  STARTED: 'started',
  COMPLETED: 'completed',
  FAILED_RETRYABLE: 'failed_retryable',
  FAILED_FINAL: 'failed_final',
});

// Fields excluded from the fingerprint source: identifiers/trace that are not
// part of the logical request, and any secret-ish keys (defense in depth).
const FINGERPRINT_EXCLUDE = new Set([
  'idempotencyKey',
  'traceId',
  'accessToken',
  'access_token',
  'webhookSecret',
  'webhook_secret',
  'secret',
  'authorization',
]);

// Deterministic canonical form (recursively sorted object keys), dropping
// excluded keys. Arrays keep order (order is semantically meaningful).
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (FINGERPRINT_EXCLUDE.has(key)) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

// Deterministic SHA-256 fingerprint of a payload (property-order independent).
function fingerprintPayload(payload) {
  const canonical = JSON.stringify(canonicalize(payload || {}));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Acquires an idempotent operation slot inside a transaction.
 * Returns:
 *   { acquired:true,  state:'started' }                        -> caller proceeds
 *   { acquired:false, state:'completed', resultReference }      -> safe replay
 *   { acquired:false, state:'started' | 'failed_retryable' }    -> in progress / retry
 * Throws IDEMPOTENCY_CONFLICT when the same key carries a different fingerprint
 * or operationType.
 * @param {object} db Firestore instance
 * @param {{idempotencyKey:string, operationType:string, actorUid?:string, traceId?:string, payload?:object}} params
 * @param {{now:()=>number}} clock
 */
async function acquireOperation(db, params, clock) {
  const { idempotencyKey, operationType, actorUid, traceId, payload } = params;
  const fingerprint = fingerprintPayload(payload);
  const ref = db.collection(IDEMPOTENCY_OPERATIONS).doc(idempotencyKey);
  const nowMs = clock.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        idempotencyKey,
        operationType,
        actorUid: actorUid || null,
        traceId: traceId || null,
        fingerprint,
        state: OPERATION_STATES.STARTED,
        resultReference: null,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { acquired: true, state: OPERATION_STATES.STARTED };
    }

    const data = snap.data() || {};
    if (data.operationType !== operationType || data.fingerprint !== fingerprint) {
      throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        internalMessage: `Idempotency conflict for key "${idempotencyKey}".`,
      });
    }
    if (data.state === OPERATION_STATES.COMPLETED) {
      return {
        acquired: false,
        state: OPERATION_STATES.COMPLETED,
        resultReference: data.resultReference || null,
      };
    }
    // started or failed_retryable -> report current state; caller decides.
    return { acquired: false, state: data.state };
  });
}

// Marks an acquired operation completed and stores a safe result reference.
async function completeOperation(db, idempotencyKey, resultReference, clock) {
  await db
    .collection(IDEMPOTENCY_OPERATIONS)
    .doc(idempotencyKey)
    .set(
      {
        state: OPERATION_STATES.COMPLETED,
        resultReference: resultReference || null,
        updatedAtMs: clock.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

// Records a retryable or final failure for an acquired operation.
async function recordFailure(db, idempotencyKey, options, clock) {
  const retryable = options && options.retryable === true;
  await db
    .collection(IDEMPOTENCY_OPERATIONS)
    .doc(idempotencyKey)
    .set(
      {
        state: retryable ? OPERATION_STATES.FAILED_RETRYABLE : OPERATION_STATES.FAILED_FINAL,
        updatedAtMs: clock.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

module.exports = {
  OPERATION_STATES,
  fingerprintPayload,
  acquireOperation,
  completeOperation,
  recordFailure,
};
