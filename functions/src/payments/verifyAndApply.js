// @ts-check
// Shared verification + application pipeline for a Mercado Pago order. Used by
// BOTH the webhook and the admin reprocess path so they behave identically and
// stay idempotent.
//
// The provider notification is NEVER trusted for status or amount: the order is
// re-fetched from Mercado Pago and verified field-by-field against the local
// paymentRequest before any money moves.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { logInfo, logWarning } = require('../logging/logger');
const { applyWalletTopup, applySubscription, markManualReview } = require('./applyPayment');
const C = require('./constants');

/**
 * @param {{db:object, adapter:object, providerOrderId:string, context:object,
 *          clock:{now:()=>number}, environment?:string, source:string}} args
 * @returns {Promise<{outcome:string, event:string, localPaymentId?:string}>}
 */
async function verifyAndApplyOrder({ db, adapter, providerOrderId, context, clock, environment, source }) {
  const traceId = context && context.traceId;

  // 1. Re-fetch the full order (provider failure -> caller decides retry).
  const order = await adapter.getOrder(providerOrderId);
  logInfo(context, 'payment.webhook.provider_refetched', {
    operation: source,
    providerOrderId,
    normalizedStatus: order.normalizedStatus,
  });

  // 2. external_reference is our immutable localPaymentId.
  const localPaymentId = order.externalReference;
  if (!localPaymentId) {
    logWarning(context, 'payment.verification_failed', { operation: source, providerOrderId, reason: 'no_external_reference' });
    return { outcome: 'verification_failed', event: 'payment.verification_failed' };
  }

  const paymentRef = db.collection(C.PAYMENT_REQUESTS).doc(localPaymentId);
  const snap = await paymentRef.get();
  if (!snap.exists) {
    logWarning(context, 'payment.verification_failed', { operation: source, providerOrderId, localPaymentId, reason: 'unknown_payment' });
    return { outcome: 'verification_failed', event: 'payment.verification_failed', localPaymentId };
  }
  const pay = snap.data() || {};

  // 3. Verify the notification really matches this local request. Any mismatch
  //    NEVER credits — it becomes manual_review.
  const mismatches = [];
  if (String(pay.providerOrderId) !== String(order.providerOrderId)) mismatches.push('providerOrderId');
  if (order.currency !== C.CURRENCY) mismatches.push('currency');
  if (Number(order.totalAmountCentavos) !== Number(pay.amountCentavos)) mismatches.push('amount');
  if (environment && pay.environment && pay.environment !== environment) mismatches.push('environment');

  if (mismatches.length > 0) {
    logWarning(context, 'payment.verification_failed', {
      operation: source,
      providerOrderId,
      localPaymentId,
      purpose: pay.purpose,
      reason: mismatches.join(','),
    });
    return {
      ...(await markManualReview({
        db,
        paymentRef,
        driverId: pay.driverId,
        reason: `mismatch:${mismatches.join(',')}`,
        traceId,
        clock,
      })),
      outcome: 'manual_review',
      localPaymentId,
    };
  }

  const norm = order.normalizedStatus;

  // 4. Refund after an already-applied payment -> manual review (never silently
  //    subtract money or dates).
  if (norm === C.STATUS.REFUNDED) {
    if (pay.appliedAtMs != null) {
      return {
        ...(await markManualReview({
          db, paymentRef, driverId: pay.driverId, reason: 'refund_after_apply', traceId, clock,
        })),
        outcome: 'manual_review',
        localPaymentId,
      };
    }
    await paymentRef.set({ status: C.STATUS.REFUNDED, updatedAt: clock.now() }, { merge: true });
    return { outcome: 'refunded', event: 'payment.manual_review', localPaymentId };
  }

  // 5. Terminal non-paid states — record status only if nothing was applied.
  if (norm === C.STATUS.EXPIRED || norm === C.STATUS.CANCELLED || norm === C.STATUS.FAILED) {
    if (pay.appliedAtMs == null) {
      await paymentRef.set({ status: norm, updatedAt: clock.now() }, { merge: true });
    }
    return { outcome: norm, event: 'payment.duplicate_ignored', localPaymentId };
  }

  // 6. Still pending — nothing to apply yet.
  if (norm === C.STATUS.PENDING) {
    return { outcome: 'pending', event: 'payment.duplicate_ignored', localPaymentId };
  }

  // 7. Inconsistent/unknown -> manual review, never paid.
  if (norm === C.STATUS.MANUAL_REVIEW) {
    return {
      ...(await markManualReview({
        db, paymentRef, driverId: pay.driverId, reason: 'inconsistent_provider_state', traceId, clock,
      })),
      outcome: 'manual_review',
      localPaymentId,
    };
  }

  // 8. PAID -> apply exactly once (idempotent inside the transaction).
  let applyRes;
  if (pay.purpose === 'wallet_topup') {
    applyRes = await applyWalletTopup({
      db, paymentRef, driverId: pay.driverId, amountCentavos: pay.amountCentavos, traceId, clock,
    });
  } else if (pay.purpose === 'driver_subscription') {
    applyRes = await applySubscription({
      db,
      paymentRef,
      driverId: pay.driverId,
      amountCentavos: pay.amountCentavos,
      processingMs: order.processingMs,
      traceId,
      clock,
    });
  } else {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `unknown payment purpose: ${pay.purpose}`,
    });
  }

  logInfo(context, applyRes.event, {
    operation: source,
    providerOrderId,
    localPaymentId,
    purpose: pay.purpose,
    normalizedStatus: C.STATUS.PAID,
    duplicate: applyRes.duplicate === true,
  });
  return { outcome: applyRes.duplicate ? 'duplicate' : 'applied', event: applyRes.event, localPaymentId };
}

module.exports = { verifyAndApplyOrder };
