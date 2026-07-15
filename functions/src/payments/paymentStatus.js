// @ts-check
// getDriverPaymentStatus (driver, own payment only) and reprocessDriverPayment
// (admin, idempotent recovery). Neither ever exposes a provider payload, token,
// signature, or internal error to the client.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateNonEmptyString } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const { requireAdmin } = require('../auth/adminAuth');
const { writeAuditLog } = require('../audit/auditLog');
const { verifyAndApplyOrder } = require('./verifyAndApply');
const C = require('./constants');

// Safe projection of a paymentRequest for the owning driver.
function safePaymentView(localPaymentId, pay) {
  return {
    localPaymentId,
    purpose: pay.purpose != null ? pay.purpose : null,
    status: pay.status != null ? pay.status : null,
    amountCentavos: pay.amountCentavos != null ? pay.amountCentavos : null,
    currency: pay.currency != null ? pay.currency : C.CURRENCY,
    qrCode: pay.qrCode != null ? pay.qrCode : null,
    qrCodeBase64: pay.qrCodeBase64 != null ? pay.qrCodeBase64 : null,
    expiration: pay.expiresAtMs != null ? pay.expiresAtMs : null,
  };
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}}} args
 */
async function getDriverPaymentStatus({ db, request, context }) {
  const driverId = request && request.auth && request.auth.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { internalMessage: 'payment status read without auth' });
  }
  const payload = assertShape(request && request.data, { required: ['localPaymentId'] });
  const localPaymentId = validateIdentifier(payload.localPaymentId, 'localPaymentId');

  const snap = await db.collection(C.PAYMENT_REQUESTS).doc(localPaymentId).get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `payment not found: ${localPaymentId}`,
      safeMetadata: { field: 'localPaymentId' },
    });
  }
  const pay = snap.data() || {};
  // A driver may read ONLY their own payment.
  if (pay.driverId !== driverId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      internalMessage: `driver ${driverId} attempted to read payment of ${pay.driverId}`,
    });
  }
  return safePaymentView(localPaymentId, pay);
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}, adapter:object, environment?:string}} args
 */
async function reprocessDriverPayment({ db, request, context, clock, adapter, environment }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, {
    required: ['localPaymentId'],
    optional: ['reason'],
  });
  const localPaymentId = validateIdentifier(payload.localPaymentId, 'localPaymentId');
  const reason = payload.reason != null ? validateNonEmptyString(payload.reason, 'reason') : 'admin_reprocess';

  const snap = await db.collection(C.PAYMENT_REQUESTS).doc(localPaymentId).get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `payment not found: ${localPaymentId}`,
      safeMetadata: { field: 'localPaymentId' },
    });
  }
  const pay = snap.data() || {};
  const providerOrderId = validateIdentifier(String(pay.providerOrderId || ''), 'providerOrderId');

  logInfo(context, 'payment.reprocess.started', {
    operation: 'reprocess',
    localPaymentId,
    providerOrderId,
    purpose: pay.purpose,
  });

  // Same verification + application pipeline as the webhook — fully idempotent.
  // The admin can NEVER inject a replacement amount or status; only the re-fetched
  // provider order drives the result.
  const res = await verifyAndApplyOrder({
    db,
    adapter,
    providerOrderId,
    context,
    clock,
    environment,
    source: 'reprocess',
  });

  await writeAuditLog(
    db,
    {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'payment_reprocess',
      targetType: 'payment',
      targetId: localPaymentId,
      reason,
      traceId: context && context.traceId,
      afterSummary: { outcome: res.outcome, providerOrderId },
    },
    clock
  );

  logInfo(context, 'payment.reprocess.completed', {
    operation: 'reprocess',
    localPaymentId,
    providerOrderId,
    outcome: res.outcome,
  });

  return { localPaymentId, outcome: res.outcome };
}

module.exports = { getDriverPaymentStatus, reprocessDriverPayment, safePaymentView };
