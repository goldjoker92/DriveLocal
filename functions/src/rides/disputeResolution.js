// @ts-check
// Secure admin dispute resolution (BLOCK 11+12). ONE callable, THREE explicit
// outcomes — never a generic setRideStatus. Ride payment stays direct
// passenger -> Pix -> driver; Mercado Pago is not involved. All financial effects
// happen in a single Firestore transaction with deterministic ledger ids so an
// outcome can never be applied twice and can never capture more than the hold.
//
// Outcomes (exact effect):
//   confirm_driver_payment   -> driver was paid off-platform: capture commission
//                               once (0 during commission-free), release the
//                               unused hold, complete the ride.
//   release_driver_hold      -> no charge is due: release the full hold once and
//                               close the ride as cancelled (no capture).
//   retain_for_manual_review -> keep the hold untouched, mark the dispute as
//                               reviewed/pending; ride stays disputed (non-final).
//
// Invariants: wallet values never go negative; capture never exceeds the hold;
// original ride/wallet history is preserved; conflicting re-resolutions rejected.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateEnum, validateNonEmptyString, validateIdempotencyKey } = require('../validation/validators');
const { writeAuditLog } = require('../audit/auditLog');
const { requireAdmin } = require('../auth/adminAuth');
const { logInfo, shortHash } = require('../logging/logger');
const driverC = require('../drivers/constants');
const C = require('./constants');

const OUTCOMES = ['confirm_driver_payment', 'release_driver_hold', 'retain_for_manual_review'];
const ts = () => admin.firestore.FieldValue.serverTimestamp();
function isCommissionFree(driver, nowMs) {
  return driver && driver.commissionFreeUntil != null && Number(driver.commissionFreeUntil) > nowMs;
}

async function resolveRideDispute({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, { required: ['rideId', 'outcome', 'reason', 'idempotencyKey'], optional: ['note'] });
  const rideId = validateIdentifier(payload.rideId, 'rideId');
  const outcome = validateEnum(payload.outcome, OUTCOMES, 'outcome');
  const reason = validateNonEmptyString(payload.reason, 'reason').slice(0, 120);
  validateIdempotencyKey(payload.idempotencyKey);
  const note = payload.note != null ? validateNonEmptyString(payload.note, 'note').slice(0, 280) : null;

  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const captureRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_capture`);
  const releaseRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_release`);
  const holdRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_hold`);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `ride not found: ${rideId}`, safeMetadata: { field: 'rideId' } });
    const ride = snap.data() || {};
    const prior = ride.disputeResolution && ride.disputeResolution.outcome;

    // Idempotent replay: the same terminal outcome was already applied.
    if (prior === outcome) return { replay: true, ride, outcome };

    if (outcome === 'retain_for_manual_review') {
      if (ride.status !== C.RIDE_STATUS.DISPUTED) throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, { internalMessage: `retain from ${ride.status}` });
      const nowMs = clock.now();
      tx.set(rideRef, {
        requiresManualReview: true,
        disputeResolution: { outcome, reasonCode: reason, note, resolvedByAdmin: adminUid, resolvedAtMs: nowMs },
        disputeReviewedAtMs: nowMs,
        updatedAt: ts(),
      }, { merge: true });
      return { replay: false, ride, outcome, captured: 0, released: 0 };
    }

    // Financial outcomes require a still-disputed ride (else it was already
    // resolved differently -> conflict).
    if (ride.status !== C.RIDE_STATUS.DISPUTED) throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, { internalMessage: `${outcome} from ${ride.status}`, safeMetadata: { reason: 'conflicting_or_invalid_dispute_state' } });

    const driverId = ride.acceptedDriverId;
    const driverRef = driverId ? db.collection(C.DRIVERS).doc(driverId) : null;
    const driverSnap = driverRef ? await tx.get(driverRef) : null;
    const driver = driverSnap && driverSnap.exists ? driverSnap.data() || {} : {};
    const originalHold = Number(ride.commissionHoldCentavos || 0);
    const nowMs = clock.now();

    if (outcome === 'confirm_driver_payment') {
      const capSnap = await tx.get(captureRef);
      if (capSnap.exists) return { replay: true, ride, outcome }; // already captured
      const finalCommission = Number(ride.finalCommissionCentavos != null ? ride.finalCommissionCentavos : ride.estimatedCommissionCentavos || 0);
      const captured = isCommissionFree(driver, nowMs) ? 0 : Math.max(0, Math.min(finalCommission, originalHold));
      if (driverRef) {
        const driverUpdate = {
          walletBalanceCentavos: Math.max(0, Number(driver.walletBalanceCentavos || 0) - captured),
          walletHeldCentavos: Math.max(0, Number(driver.walletHeldCentavos || 0) - originalHold),
          walletAvailableCentavos: Math.max(0, Number(driver.walletAvailableCentavos || 0) + (originalHold - captured)),
          activeRideId: null,
          completedRideCount: Number(driver.completedRideCount || 0) + 1,
          updatedAt: ts(),
        };
        if (driver.founderEligible !== true && Number(driver.freeRideCountUsed || 0) < driverC.FREE_RIDE_LIMIT) {
          driverUpdate.freeRideCountUsed = Number(driver.freeRideCountUsed || 0) + 1;
        }
        tx.set(driverRef, driverUpdate, { merge: true });
      }
      tx.set(rideRef, {
        status: C.RIDE_STATUS.COMPLETED, completedAtMs: nowMs, completedAt: ts(),
        commissionCapturedCentavos: captured, holdReleasedCentavos: originalHold - captured, commissionHoldCentavos: 0,
        disputeResolution: { outcome, reasonCode: reason, note, resolvedByAdmin: adminUid, resolvedAtMs: nowMs },
        disputeResolutionStatus: 'resolved', updatedAt: ts(),
      }, { merge: true });
      tx.set(holdRef, { status: 'settled', settledAtMs: nowMs }, { merge: true });
      tx.set(captureRef, { driverId: driverId || null, rideId, type: 'commission_capture', source: 'dispute_resolution', amountCentavos: captured, releasedCentavos: originalHold - captured, status: 'captured', createdAtMs: nowMs, createdAt: ts(), traceId: context && context.traceId });
      return { replay: false, ride, outcome, captured, released: originalHold - captured };
    }

    // release_driver_hold
    const relSnap = await tx.get(releaseRef);
    if (relSnap.exists) return { replay: true, ride, outcome }; // already released
    if (driverRef) {
      tx.set(driverRef, {
        walletHeldCentavos: Math.max(0, Number(driver.walletHeldCentavos || 0) - originalHold),
        walletAvailableCentavos: Math.max(0, Number(driver.walletAvailableCentavos || 0) + originalHold),
        activeRideId: null, updatedAt: ts(),
      }, { merge: true });
    }
    tx.set(rideRef, {
      status: C.RIDE_STATUS.CANCELLED, cancelledAtMs: nowMs, cancelledBy: 'admin_dispute',
      commissionHoldCentavos: 0, holdReleasedCentavos: originalHold,
      disputeResolution: { outcome, reasonCode: reason, note, resolvedByAdmin: adminUid, resolvedAtMs: nowMs },
      disputeResolutionStatus: 'resolved', updatedAt: ts(),
    }, { merge: true });
    tx.set(holdRef, { status: 'released', settledAtMs: nowMs }, { merge: true });
    tx.set(releaseRef, { driverId: driverId || null, rideId, type: 'commission_hold_release', source: 'dispute_resolution', amountCentavos: originalHold, status: 'released', createdAtMs: nowMs, createdAt: ts() });
    return { replay: false, ride, outcome, captured: 0, released: originalHold };
  });

  if (!out.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid, actorType: 'admin', action: 'dispute_resolution', targetType: 'ride', targetId: rideId, reason,
      traceId: context && context.traceId,
      beforeSummary: { status: out.ride.status || null },
      afterSummary: { outcome, capturedCommissionCentavos: out.captured || 0, holdReleasedCentavos: out.released || 0 },
    }, clock);
    logInfo(context, 'admin.dispute_resolved', { operation: 'resolve_dispute', rideId, adminIdHash: shortHash(adminUid), reasonCode: reason, result: outcome, amountCentavos: out.captured || 0 });
  }
  return { rideId, outcome, replay: out.replay === true, capturedCommissionCentavos: out.captured || 0, holdReleasedCentavos: out.released || 0 };
}

module.exports = { resolveRideDispute, DISPUTE_OUTCOMES: OUTCOMES };
