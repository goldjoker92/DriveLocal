// @ts-check
// Secure admin dispute resolution. ONE callable, THREE explicit outcomes — never
// a generic setRideStatus. Ride payment stays direct passenger -> Pix -> driver;
// Mercado Pago is not involved. All financial effects happen in one Firestore
// transaction with deterministic ledger ids so an outcome can never be applied
// twice and can never capture more than the hold frozen at ride acceptance.
//
// Outcomes:
//   confirm_driver_payment   -> driver was paid off-platform: capture commission
//                               once, release unused hold, complete the ride.
//   release_driver_hold      -> no charge is due: release full hold once and close
//                               the ride as cancelled.
//   retain_for_manual_review -> keep hold untouched; ride remains disputed.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateIdentifier,
  validateEnum,
  validateNonEmptyString,
  validateIdempotencyKey,
} = require('../validation/validators');
const { writeAuditLog } = require('../audit/auditLog');
const { requireAdmin } = require('../auth/adminAuth');
const { logInfo, shortHash } = require('../logging/logger');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const driverC = require('../drivers/constants');
const C = require('./constants');

const OUTCOMES = [
  'confirm_driver_payment',
  'release_driver_hold',
  'retain_for_manual_review',
];
const ts = () => admin.firestore.FieldValue.serverTimestamp();

function settlementFromFrozenHold(ride) {
  const originalHold = Math.max(0, Number(ride?.commissionHoldCentavos || 0));
  const finalCommission = Math.max(
    0,
    Number(ride?.finalCommissionCentavos != null
      ? ride.finalCommissionCentavos
      : ride?.estimatedCommissionCentavos || 0)
  );
  const captured = Math.min(finalCommission, originalHold);
  return {
    originalHold,
    finalCommission,
    captured,
    released: originalHold - captured,
  };
}

function setDriverOfferStatusTx(tx, db, rideId, driverId, status, extra = {}) {
  if (!driverId) return;
  tx.set(db.collection(C.DRIVER_OFFERS).doc(`${rideId}_${driverId}`), {
    driverRideStatus: status,
    ...extra,
    updatedAt: ts(),
  }, { merge: true });
}

function clearActiveRideIfCurrentTx(tx, ref, snapshot, rideId) {
  if (!ref || !snapshot?.exists) return false;
  const profile = snapshot.data() || {};
  if (profile.activeRideId !== rideId) return false;
  tx.set(ref, { activeRideId: null, updatedAt: ts() }, { merge: true });
  return true;
}

async function resolveRideDispute({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, {
    required: ['rideId', 'outcome', 'reason', 'idempotencyKey'],
    optional: ['note'],
  });
  const rideId = validateIdentifier(payload.rideId, 'rideId');
  const outcome = validateEnum(payload.outcome, OUTCOMES, 'outcome');
  const reason = validateNonEmptyString(payload.reason, 'reason').slice(0, 120);
  validateIdempotencyKey(payload.idempotencyKey);
  const note = payload.note != null
    ? validateNonEmptyString(payload.note, 'note').slice(0, 280)
    : null;

  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const captureRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_capture`);
  const releaseRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_release`);
  const holdRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_hold`);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
        safeMetadata: { field: 'rideId' },
      });
    }
    const ride = snap.data() || {};
    const prior = ride.disputeResolution && ride.disputeResolution.outcome;

    // Idempotent replay: the same terminal outcome was already applied.
    if (prior === outcome) return { replay: true, ride, outcome };

    if (outcome === 'retain_for_manual_review') {
      if (ride.status !== C.RIDE_STATUS.DISPUTED) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
          internalMessage: `retain from ${ride.status}`,
        });
      }
      const nowMs = clock.now();
      tx.set(rideRef, {
        requiresManualReview: true,
        commissionSettlementStatus: 'disputed',
        disputeResolution: {
          outcome,
          reasonCode: reason,
          note,
          resolvedByAdmin: adminUid,
          resolvedAtMs: nowMs,
        },
        disputeReviewedAtMs: nowMs,
        updatedAt: ts(),
      }, { merge: true });
      return {
        replay: false,
        ride,
        outcome,
        captured: 0,
        released: 0,
        originalHold: Number(ride.commissionHoldCentavos || 0),
      };
    }

    if (ride.status !== C.RIDE_STATUS.DISPUTED) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `${outcome} from ${ride.status}`,
        safeMetadata: { reason: 'conflicting_or_invalid_dispute_state' },
      });
    }

    const driverId = ride.acceptedDriverId;
    const passengerId = ride.passengerId;
    const driverRef = driverId ? db.collection(C.DRIVERS).doc(driverId) : null;
    const passengerRef = passengerId ? db.collection(C.PASSENGERS).doc(passengerId) : null;
    const driverSnap = driverRef ? await tx.get(driverRef) : null;
    const passengerSnap = passengerRef ? await tx.get(passengerRef) : null;
    const driver = driverSnap?.exists ? driverSnap.data() || {} : {};
    const settlement = settlementFromFrozenHold(ride);
    const nowMs = clock.now();

    if (outcome === 'confirm_driver_payment') {
      const capSnap = await tx.get(captureRef);
      if (capSnap.exists) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
          internalMessage: `capture exists while disputed ride is unresolved: ${rideId}`,
          safeMetadata: { reason: 'DISPUTE_CAPTURE_ALREADY_EXISTS' },
        });
      }

      if (driverRef) {
        const driverUpdate = {
          walletBalanceCentavos: Math.max(
            0,
            Number(driver.walletBalanceCentavos || 0) - settlement.captured
          ),
          walletHeldCentavos: Math.max(
            0,
            Number(driver.walletHeldCentavos || 0) - settlement.originalHold
          ),
          walletAvailableCentavos: Math.max(
            0,
            Number(driver.walletAvailableCentavos || 0) + settlement.released
          ),
          completedRideCount: Number(driver.completedRideCount || 0) + 1,
          updatedAt: ts(),
        };
        // The disputed ride was already detached. Never clear a newer active ride
        // accepted while this old case waited for admin review.
        if (driver.activeRideId === rideId) driverUpdate.activeRideId = null;
        if (
          driver.founderEligible !== true
          && Number(driver.freeRideCountUsed || 0) < driverC.FREE_RIDE_LIMIT
        ) {
          driverUpdate.freeRideCountUsed = Number(driver.freeRideCountUsed || 0) + 1;
        }
        tx.set(driverRef, driverUpdate, { merge: true });
      }
      clearActiveRideIfCurrentTx(tx, passengerRef, passengerSnap, rideId);

      tx.set(rideRef, {
        status: C.RIDE_STATUS.COMPLETED,
        completedAtMs: nowMs,
        completedAt: ts(),
        commissionCapturedCentavos: settlement.captured,
        holdReleasedCentavos: settlement.released,
        commissionSettlementStatus: settlement.originalHold > 0 ? 'captured' : 'free',
        requiresManualReview: false,
        disputeResolution: {
          outcome,
          reasonCode: reason,
          note,
          resolvedByAdmin: adminUid,
          resolvedAtMs: nowMs,
        },
        disputeResolutionStatus: 'resolved',
        updatedAt: ts(),
      }, { merge: true });
      setDriverOfferStatusTx(tx, db, rideId, driverId, C.RIDE_STATUS.COMPLETED, {
        completedAtMs: nowMs,
      });

      if (settlement.originalHold > 0) {
        tx.set(holdRef, {
          status: 'settled',
          capturedCentavos: settlement.captured,
          releasedCentavos: settlement.released,
          settledAtMs: nowMs,
          settledAt: ts(),
        }, { merge: true });
        tx.set(captureRef, {
          driverId: driverId || null,
          rideId,
          type: 'commission_capture',
          source: 'dispute_resolution',
          amountCentavos: settlement.captured,
          releasedCentavos: settlement.released,
          status: 'captured',
          policyVersion: ride.commissionPolicySnapshot?.policyVersion || 'legacy-hold',
          createdAtMs: nowMs,
          createdAt: ts(),
          traceId: context && context.traceId,
        });
      }
      if (passengerId) {
        enqueueEventTx(tx, db, buildNotificationEvent({
          rideId,
          eventType: C.NOTIFICATION_EVENT.RIDE_COMPLETED,
          recipientUid: passengerId,
          recipientRole: 'passenger',
          route: '/pix-payment',
          traceId: context?.traceId,
          nowMs,
        }));
      }
      if (driverId) {
        enqueueEventTx(tx, db, buildNotificationEvent({
          rideId,
          eventType: C.NOTIFICATION_EVENT.RIDE_COMPLETED,
          recipientUid: driverId,
          recipientRole: 'driver',
          route: '/active-ride',
          traceId: context?.traceId,
          nowMs,
        }));
      }
      return { replay: false, ride, outcome, ...settlement };
    }

    // release_driver_hold
    const relSnap = await tx.get(releaseRef);
    if (relSnap.exists) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `release exists while disputed ride is unresolved: ${rideId}`,
        safeMetadata: { reason: 'DISPUTE_RELEASE_ALREADY_EXISTS' },
      });
    }
    if (driverRef) {
      const driverUpdate = {
        walletHeldCentavos: Math.max(
          0,
          Number(driver.walletHeldCentavos || 0) - settlement.originalHold
        ),
        walletAvailableCentavos: Math.max(
          0,
          Number(driver.walletAvailableCentavos || 0) + settlement.originalHold
        ),
        updatedAt: ts(),
      };
      if (driver.activeRideId === rideId) driverUpdate.activeRideId = null;
      tx.set(driverRef, driverUpdate, { merge: true });
    }
    clearActiveRideIfCurrentTx(tx, passengerRef, passengerSnap, rideId);
    tx.set(rideRef, {
      status: C.RIDE_STATUS.CANCELLED,
      cancelledAtMs: nowMs,
      cancelledBy: 'admin_dispute',
      commissionOriginalHoldCentavos: settlement.originalHold,
      commissionHoldCentavos: 0,
      holdReleasedCentavos: settlement.originalHold,
      commissionSettlementStatus: settlement.originalHold > 0 ? 'released' : 'free',
      requiresManualReview: false,
      disputeResolution: {
        outcome,
        reasonCode: reason,
        note,
        resolvedByAdmin: adminUid,
        resolvedAtMs: nowMs,
      },
      disputeResolutionStatus: 'resolved',
      updatedAt: ts(),
    }, { merge: true });
    setDriverOfferStatusTx(tx, db, rideId, driverId, C.RIDE_STATUS.CANCELLED, {
      cancelledAtMs: nowMs,
    });

    if (settlement.originalHold > 0) {
      tx.set(holdRef, {
        status: 'released',
        releasedCentavos: settlement.originalHold,
        settledAtMs: nowMs,
        settledAt: ts(),
      }, { merge: true });
      tx.set(releaseRef, {
        driverId: driverId || null,
        rideId,
        type: 'commission_hold_release',
        source: 'dispute_resolution',
        amountCentavos: settlement.originalHold,
        status: 'released',
        reasonCode: reason,
        createdAtMs: nowMs,
        createdAt: ts(),
        traceId: context && context.traceId,
      });
    }
    if (passengerId) {
      enqueueEventTx(tx, db, buildNotificationEvent({
        rideId,
        eventType: C.NOTIFICATION_EVENT.RIDE_CANCELLED,
        recipientUid: passengerId,
        recipientRole: 'passenger',
        route: '/passenger-home',
        traceId: context?.traceId,
        nowMs,
      }));
    }
    if (driverId) {
      enqueueEventTx(tx, db, buildNotificationEvent({
        rideId,
        eventType: C.NOTIFICATION_EVENT.RIDE_CANCELLED,
        recipientUid: driverId,
        recipientRole: 'driver',
        route: '/driver-home',
        traceId: context?.traceId,
        nowMs,
      }));
    }
    return {
      replay: false,
      ride,
      outcome,
      captured: 0,
      released: settlement.originalHold,
      originalHold: settlement.originalHold,
    };
  });

  if (!out.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'dispute_resolution',
      targetType: 'ride',
      targetId: rideId,
      reason,
      traceId: context && context.traceId,
      beforeSummary: { status: out.ride.status || null },
      afterSummary: {
        outcome,
        capturedCommissionCentavos: out.captured || 0,
        holdReleasedCentavos: out.released || 0,
        originalHoldCentavos: out.originalHold || 0,
      },
    }, clock);
    logInfo(context, 'admin.dispute_resolved', {
      operation: 'resolve_dispute',
      rideId,
      adminIdHash: shortHash(adminUid),
      reasonCode: reason,
      result: outcome,
      amountCentavos: out.captured || 0,
    });
  }
  return {
    rideId,
    outcome,
    replay: out.replay === true,
    capturedCommissionCentavos: out.captured || 0,
    holdReleasedCentavos: out.released || 0,
  };
}

module.exports = {
  resolveRideDispute,
  DISPUTE_OUTCOMES: OUTCOMES,
  settlementFromFrozenHold,
  setDriverOfferStatusTx,
  clearActiveRideIfCurrentTx,
};
