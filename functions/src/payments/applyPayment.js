// @ts-check
// Transactional application of a CONFIRMED Mercado Pago payment. Called only
// after the webhook/reprocess pipeline has re-fetched and verified the order
// against the local paymentRequest. Every path is idempotent: a payment already
// marked applied is never applied twice.
//
// Money stays integer centavos. walletHeldCentavos is never touched here.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { writeAuditLog } = require('../audit/auditLog');
const DRIVERS = require('../drivers/constants').DRIVERS;
const C = require('./constants');

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/**
 * Applies a paid wallet top-up in a single transaction.
 * @param {{db:object, paymentRef:object, driverId:string, amountCentavos:number,
 *          traceId?:string, clock:{now:()=>number}}} args
 * @returns {Promise<{applied:boolean, duplicate:boolean, event:string}>}
 */
async function applyWalletTopup({ db, paymentRef, driverId, amountCentavos, traceId, clock }) {
  const driverRef = db.collection(DRIVERS).doc(driverId);
  const walletTxRef = db.collection(C.WALLET_TRANSACTIONS).doc();
  const nowMs = clock.now();

  const outcome = await db.runTransaction(async (tx) => {
    const paySnap = await tx.get(paymentRef);
    const pay = paySnap.exists ? paySnap.data() || {} : {};
    // Idempotent: already applied -> credit exactly once.
    if (pay.status === C.STATUS.PAID && pay.appliedAtMs != null) {
      return { applied: false, duplicate: true };
    }

    const drvSnap = await tx.get(driverRef);
    const drv = drvSnap.exists ? drvSnap.data() || {} : {};
    const balance = Number(drv.walletBalanceCentavos || 0) + amountCentavos;
    const available = Number(drv.walletAvailableCentavos || 0) + amountCentavos;

    tx.set(
      driverRef,
      {
        walletBalanceCentavos: balance,
        walletAvailableCentavos: available,
        // walletHeldCentavos intentionally unchanged.
        updatedAt: ts(),
      },
      { merge: true }
    );
    // Append-only ledger record.
    tx.set(walletTxRef, {
      type: 'topup',
      driverId,
      amountCentavos,
      currency: C.CURRENCY,
      source: C.PROVIDER,
      paymentId: paymentRef.id,
      balanceAfterCentavos: balance,
      createdAtMs: nowMs,
      createdAt: ts(),
    });
    tx.set(
      paymentRef,
      { status: C.STATUS.PAID, appliedAtMs: nowMs, appliedAt: ts(), updatedAt: ts() },
      { merge: true }
    );
    return { applied: true, duplicate: false, balanceAfter: balance };
  });

  if (outcome.applied) {
    await writeAuditLog(
      db,
      {
        actorUid: 'system',
        actorType: 'system',
        action: 'wallet_topup_credited',
        targetType: 'driver',
        targetId: driverId,
        traceId: traceId || null,
        afterSummary: { amountCentavos, paymentId: paymentRef.id, balanceAfterCentavos: outcome.balanceAfter },
      },
      clock
    );
    return { applied: true, duplicate: false, event: 'payment.wallet_credited' };
  }
  return { applied: false, duplicate: true, event: 'payment.duplicate_ignored' };
}

/**
 * Flags a payment for manual review (mismatch, refund-after-apply, inconsistent
 * provider state). Never silently changes money or dates.
 * @param {{db:object, paymentRef:object, driverId?:string, reason:string,
 *          traceId?:string, clock:{now:()=>number}}} args
 */
async function markManualReview({ db, paymentRef, driverId, reason, traceId, clock }) {
  await paymentRef.set(
    { status: C.STATUS.MANUAL_REVIEW, manualReviewReason: reason, updatedAt: ts() },
    { merge: true }
  );
  await writeAuditLog(
    db,
    {
      actorUid: 'system',
      actorType: 'system',
      action: 'payment_manual_review',
      targetType: 'payment',
      targetId: paymentRef.id,
      traceId: traceId || null,
      afterSummary: { reason, driverId: driverId || null },
    },
    clock
  );
  return { applied: false, duplicate: false, event: 'payment.manual_review' };
}

module.exports = { applyWalletTopup, markManualReview };
