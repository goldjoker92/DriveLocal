// @ts-check
// Secure driver approval. One Firestore transaction owns the atomic per-city
// approval counter and the founder assignment so concurrent/repeated approvals
// can never double-count or restart benefits.
//
// Founder rule (per serviceAreaId; moto and car share one counter):
//   first FOUNDER_LIMIT approved drivers are founders; #101+ are not.
// Repeat approval is idempotent: no counter increment, benefits preserved.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier } = require('../validation/validators');
const { writeAuditLog } = require('../audit/auditLog');
const { requireAdmin } = require('../auth/adminAuth');
const { safeDriverView } = require('./eligibility');
const C = require('./constants');

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}}} args
 */
async function approveDriver({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, { required: ['driverId'] });
  const driverId = validateIdentifier(payload.driverId, 'driverId');

  const driverRef = db.collection(C.DRIVERS).doc(driverId);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `driver not found: ${driverId}`,
        safeMetadata: { field: 'driverId' },
      });
    }
    const before = snap.data() || {};

    // Idempotent replay: already approved once -> never increment, never restart.
    if (before.approvalNumber != null) {
      return { replay: true, after: before };
    }

    const serviceAreaId = validateIdentifier(before.serviceAreaId, 'serviceAreaId');
    const counterRef = db.collection(C.COUNTERS).doc(serviceAreaId);
    const counterSnap = await tx.get(counterRef);
    const current = counterSnap.exists ? Number((counterSnap.data() || {}).approvedCount || 0) : 0;
    const approvalNumber = current + 1;
    const isFounder = approvalNumber <= C.FOUNDER_LIMIT;

    const nowMs = clock.now();
    const freePeriodEnd = nowMs + C.FREE_PERIOD_DAYS * C.DAY_MS;

    const update = {
      verificationStatus: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedAtMs: nowMs,
      approvalNumber,
      founderEligible: isFounder,
      founderNumber: isFounder ? approvalNumber : null,
      founderGrantedAt: isFounder ? admin.firestore.FieldValue.serverTimestamp() : null,
      founderExpiresAt: isFounder ? freePeriodEnd : null,
      // Launch rule: every newly approved driver receives 60 days at 0%
      // commission. Founders additionally receive 60 days of subscription cover.
      commissionFreeUntil: freePeriodEnd,
      subscriptionFreeUntil: isFounder ? freePeriodEnd : null,
      reviewedBy: adminUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Initialize safe counters/totals only when absent — never overwrite history.
    if (before.freeRideCountUsed == null) update.freeRideCountUsed = 0;
    if (before.walletBalanceCentavos == null) update.walletBalanceCentavos = 0;
    if (before.walletHeldCentavos == null) update.walletHeldCentavos = 0;
    if (before.walletAvailableCentavos == null) update.walletAvailableCentavos = 0;
    if (before.isBlocked == null) update.isBlocked = false;

    tx.set(
      counterRef,
      {
        serviceAreaId,
        approvedCount: approvalNumber,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(driverRef, update, { merge: true });

    return {
      replay: false,
      before,
      after: { ...before, ...update, approvedAtMs: nowMs },
    };
  });

  if (!outcome.replay) {
    await writeAuditLog(
      db,
      {
        actorUid: adminUid,
        actorType: 'admin',
        action: 'driver_approved',
        targetType: 'driver',
        targetId: driverId,
        traceId: context && context.traceId,
        beforeSummary: { verificationStatus: outcome.before.verificationStatus || null },
        afterSummary: {
          verificationStatus: 'approved',
          approvalNumber: outcome.after.approvalNumber,
          founderNumber: outcome.after.founderNumber,
        },
      },
      clock
    );
  }

  return safeDriverView(driverId, outcome.after);
}

module.exports = { approveDriver };
