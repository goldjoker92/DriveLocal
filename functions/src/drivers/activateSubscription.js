// @ts-check
// Temporary manual admin subscription activation (until Mercado Pago). The plan
// price is derived server-side from the driver's vehicleType and is NEVER
// accepted from the client. Idempotency-keyed so a retried activation cannot
// double-charge or double-extend.
//
// Extension rule:
//   - active subscription -> extend from current expiration;
//   - expired/none        -> start from current server time.
// Never modifies approvedAt, founderNumber, commissionFreeUntil, or
// freeRideCountUsed.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateIdempotencyKey } = require('../validation/validators');
const { writeAuditLog } = require('../audit/auditLog');
const { requireAdmin } = require('../auth/adminAuth');
const { acquireOperation, completeOperation, OPERATION_STATES } = require('../idempotency/idempotency');
const { computeSubscriptionExtension } = require('./subscriptionDomain');
const C = require('./constants');

const OPERATION_TYPE = 'activate_subscription_manual';

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}}} args
 */
async function activateSubscription({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, {
    required: ['driverId', 'idempotencyKey'],
  });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey);

  // Idempotency: same key + same driver -> safe replay of the stored result.
  const acq = await acquireOperation(
    db,
    {
      idempotencyKey,
      operationType: OPERATION_TYPE,
      actorUid: adminUid,
      traceId: context && context.traceId,
      payload: { driverId },
    },
    clock
  );
  if (!acq.acquired) {
    if (acq.state === OPERATION_STATES.COMPLETED) {
      return acq.resultReference || null;
    }
    // Started or transient failure elsewhere — do not run a second activation.
    throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
      internalMessage: `subscription activation already in progress for key "${idempotencyKey}"`,
    });
  }

  const driverRef = db.collection(C.DRIVERS).doc(driverId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `driver not found: ${driverId}`,
        safeMetadata: { field: 'driverId' },
      });
    }
    const d = snap.data() || {};
    const nowMs = clock.now();
    const { vehicleType, priceCentavos, isActive, newExpiry } = computeSubscriptionExtension(d, nowMs);

    tx.set(
      driverRef,
      {
        subscriptionActive: true,
        subscriptionStatus: 'active',
        subscriptionExpiresAt: newExpiry,
        subscriptionActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        subscriptionActivatedAtMs: nowMs,
        subscriptionPaymentMode: 'manual_admin',
        subscriptionLastAmountCentavos: priceCentavos,
        subscriptionLastConfirmedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      driverId,
      vehicleType,
      priceCentavos,
      subscriptionExpiresAt: newExpiry,
      extendedFromActive: isActive,
      paymentMode: 'manual_admin',
    };
  });

  await writeAuditLog(
    db,
    {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'subscription_activated_manual',
      targetType: 'driver',
      targetId: driverId,
      reason: 'manual_admin',
      traceId: context && context.traceId,
      afterSummary: {
        priceCentavos: result.priceCentavos,
        subscriptionExpiresAt: result.subscriptionExpiresAt,
        paymentMode: 'manual_admin',
      },
    },
    clock
  );

  await completeOperation(db, idempotencyKey, result, clock);
  return result;
}

module.exports = { activateSubscription };
