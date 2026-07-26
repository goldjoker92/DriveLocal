// @ts-check
// Secure cancellation lifecycle. Cancellation never captures commission and never
// charges a passenger fee in V1. The server validates actor-specific reason codes,
// records timing/arrival context and enforces the passenger no-show waiting period.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateIdentifier,
  validateIdempotencyKey,
  validateNonEmptyString,
} = require('../validation/validators');
const { logInfo, logWarning } = require('../logging/logger');
const { writeAuditLog } = require('../audit/auditLog');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const { bestEffortRiskSignal } = require('../risk/riskEngine');
const riskC = require('../risk/constants');
const C = require('./constants');
const {
  CANCELLATION_FEE_POLICY_VERSION,
  isAllowedCancellationReason,
  cancellationStage,
  cancellationTiming,
  passengerNoShowEligibility,
} = require('./cancellationPolicy');

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function requireAuthUid(request) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'ride cancellation without authentication',
    });
  }
  return uid;
}

function cancellationArgs(request) {
  const payload = assertShape(request?.data, {
    required: ['rideId', 'idempotencyKey', 'reasonCode'],
    optional: [],
  });
  return {
    rideId: validateIdentifier(payload.rideId, 'rideId'),
    idempotencyKey: validateIdempotencyKey(payload.idempotencyKey),
    reasonCode: validateNonEmptyString(payload.reasonCode, 'reasonCode').slice(0, 40),
  };
}

function cancellationActor(ride, uid) {
  if (ride?.passengerId === uid) return 'passenger';
  if (ride?.acceptedDriverId === uid) return 'driver';
  return null;
}

function assertCancellationAllowed({ ride, role, reasonCode, nowMs }) {
  const cancellable = role === 'passenger'
    ? [C.RIDE_STATUS.SEARCHING, C.RIDE_STATUS.ASSIGNED, C.RIDE_STATUS.DRIVER_ARRIVED]
    : [C.RIDE_STATUS.ASSIGNED, C.RIDE_STATUS.DRIVER_ARRIVED];

  if (!cancellable.includes(ride.status)) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `ride cannot be cancelled from status ${ride.status}`,
      safeMetadata: { status: ride.status },
    });
  }
  if (!isAllowedCancellationReason(role, reasonCode)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'cancellation reason is not allowed for actor role',
      safeMetadata: { field: 'reasonCode', role },
    });
  }

  if (role === 'driver' && reasonCode === 'passenger_no_show') {
    const eligibility = passengerNoShowEligibility(ride, nowMs);
    if (!eligibility.eligible) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'passenger no-show waiting period not completed',
        safeMetadata: {
          reason: eligibility.correctPhase
            ? 'PASSENGER_NO_SHOW_WAIT_REQUIRED'
            : 'DRIVER_ARRIVAL_REQUIRED',
          remainingMs: eligibility.remainingMs,
          eligibleAtMs: eligibility.eligibleAtMs,
        },
      });
    }
  }
}

function setDriverOfferCancelledTx(tx, db, rideId, driverId, cancellation) {
  if (!driverId) return;
  tx.set(
    db.collection(C.DRIVER_OFFERS).doc(`${rideId}_${driverId}`),
    {
      driverRideStatus: C.RIDE_STATUS.CANCELLED,
      cancelledAtMs: cancellation.cancelledAtMs,
      cancelledBy: cancellation.cancelledBy,
      cancelReasonCode: cancellation.cancelReasonCode,
      cancellationStage: cancellation.cancellationStage,
      updatedAt: ts(),
    },
    { merge: true }
  );
}

function cancellationRisk(priorStatus, role, reasonCode) {
  const arrived = priorStatus === C.RIDE_STATUS.DRIVER_ARRIVED;
  if (role === 'driver' && reasonCode === 'passenger_no_show') {
    return {
      actorType: riskC.ACTOR_TYPE.PASSENGER,
      reasonCode: riskC.REASON.PASSENGER_NO_SHOW,
      severity: riskC.SEVERITY.HIGH,
      recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
    };
  }
  return {
    actorType: role === 'passenger' ? riskC.ACTOR_TYPE.PASSENGER : riskC.ACTOR_TYPE.DRIVER,
    reasonCode: role === 'passenger'
      ? riskC.REASON.PASSENGER_LATE_CANCELLATION
      : riskC.REASON.DRIVER_LATE_CANCELLATION,
    severity: arrived ? riskC.SEVERITY.HIGH : riskC.SEVERITY.MEDIUM,
    recommendedAction: arrived ? riskC.ACTION.REQUIRE_REVIEW : riskC.ACTION.WARN,
  };
}

async function cancelRide({ db, request, context, clock }) {
  const uid = requireAuthUid(request);
  const { rideId, reasonCode } = cancellationArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: 'ride not found for cancellation',
      });
    }
    const ride = snap.data() || {};
    const role = cancellationActor(ride, uid);
    if (!role) {
      throw new AppError(ERROR_CODES.FORBIDDEN, {
        internalMessage: 'caller is not a party to the ride',
      });
    }
    if (ride.status === C.RIDE_STATUS.CANCELLED) {
      return {
        replay: true,
        role,
        priorStatus: ride.cancellationPriorStatus || null,
        reasonCode: ride.cancelReasonCode || reasonCode,
        cancellationStage: ride.cancellationStage || null,
      };
    }

    const nowMs = Number(clock.now());
    assertCancellationAllowed({ ride, role, reasonCode, nowMs });

    const priorStatus = ride.status;
    const hold = Math.max(0, Number(ride.commissionHoldCentavos || 0));
    const timing = cancellationTiming(ride, nowMs);
    const stage = cancellationStage(priorStatus);

    if (ride.acceptedDriverId && hold > 0) {
      const driverRef = db.collection(C.DRIVERS).doc(ride.acceptedDriverId);
      const driverSnap = await tx.get(driverRef);
      const driver = driverSnap.exists ? driverSnap.data() || {} : {};
      tx.set(driverRef, {
        walletHeldCentavos: Math.max(0, Number(driver.walletHeldCentavos || 0) - hold),
        walletAvailableCentavos: Math.max(0, Number(driver.walletAvailableCentavos || 0) + hold),
        activeRideId: null,
        updatedAt: ts(),
      }, { merge: true });
      tx.set(db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_release`), {
        driverId: ride.acceptedDriverId,
        rideId,
        type: 'commission_hold_release',
        amountCentavos: hold,
        status: 'released',
        reasonCode,
        createdAtMs: nowMs,
        createdAt: ts(),
        traceId: context?.traceId || null,
      });
      tx.set(db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_hold`), {
        status: 'released',
        releasedCentavos: hold,
        settledAtMs: nowMs,
        settledAt: ts(),
      }, { merge: true });
    } else if (ride.acceptedDriverId) {
      tx.set(db.collection(C.DRIVERS).doc(ride.acceptedDriverId), {
        activeRideId: null,
        updatedAt: ts(),
      }, { merge: true });
    }

    const otherUid = role === 'passenger' ? ride.acceptedDriverId : ride.passengerId;
    const notification = otherUid
      ? buildNotificationEvent({
          rideId,
          eventType: C.NOTIFICATION_EVENT.RIDE_CANCELLED,
          recipientUid: otherUid,
          recipientRole: role === 'passenger' ? 'driver' : 'passenger',
          route: role === 'passenger' ? '/driver-home' : '/passenger-home',
          traceId: context?.traceId,
          nowMs,
        })
      : null;

    const cancellation = {
      status: C.RIDE_STATUS.CANCELLED,
      cancelledAtMs: nowMs,
      cancelledAt: ts(),
      cancelledBy: role,
      cancelReasonCode: reasonCode,
      cancellationPriorStatus: priorStatus,
      cancellationStage: stage,
      cancellationElapsedSinceCreatedMs: timing.cancellationElapsedSinceCreatedMs,
      cancellationElapsedSinceAssignedMs: timing.cancellationElapsedSinceAssignedMs,
      cancellationWaitAfterArrivalMs: timing.cancellationWaitAfterArrivalMs,
      driverHadArrived: timing.driverHadArrived,
      driverArrivedAtMs: timing.driverArrivedAtMs,
      passengerNoShowEligibleAtMs: timing.passengerNoShowEligibleAtMs,
      cancellationFeeCentavos: 0,
      cancellationFeePolicyVersion: CANCELLATION_FEE_POLICY_VERSION,
      cancellationNotificationEventId: notification?.id || null,
      cancellationNotificationStatus: notification ? C.NOTIFICATION_STATUS.PENDING : 'not_required',
      commissionOriginalHoldCentavos: hold,
      commissionHoldCentavos: 0,
      holdReleasedCentavos: hold,
      commissionCapturedCentavos: 0,
      commissionSettlementStatus: hold > 0 ? 'released' : 'free',
      updatedAt: ts(),
    };

    setDriverOfferCancelledTx(tx, db, rideId, ride.acceptedDriverId, cancellation);
    tx.delete(db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(rideId));
    tx.set(rideRef, cancellation, { merge: true });
    if (ride.passengerId) {
      tx.set(db.collection(C.PASSENGERS).doc(ride.passengerId), {
        activeRideId: null,
        updatedAt: ts(),
      }, { merge: true });
    }
    if (notification) enqueueEventTx(tx, db, notification);

    return {
      replay: false,
      role,
      priorStatus,
      reasonCode,
      stage,
      hold,
      passengerId: ride.passengerId || null,
      driverId: ride.acceptedDriverId || null,
      vehicleType: ride.vehicleType || null,
      timing,
      notificationId: notification?.id || null,
    };
  });

  if (!out.replay) {
    try {
      await writeAuditLog(db, {
        actorUid: uid,
        actorType: out.role,
        action: 'ride_cancelled',
        targetType: 'ride',
        targetId: rideId,
        traceId: context?.traceId,
        afterSummary: {
          reasonCode: out.reasonCode,
          priorStatus: out.priorStatus,
          cancellationStage: out.stage,
          driverHadArrived: out.timing.driverHadArrived,
          cancellationWaitAfterArrivalMs: out.timing.cancellationWaitAfterArrivalMs,
          cancellationFeeCentavos: 0,
          notificationQueued: Boolean(out.notificationId),
        },
      }, clock);
    } catch (auditError) {
      // The cancellation transaction has already committed. Never tell the user it
      // failed or recreate financial state because a secondary audit write failed.
      logWarning(context, 'ride.cancellation_audit_failed', {
        operation: 'cancel',
        rideId,
        errorCode: auditError?.code || auditError?.name || 'AUDIT_WRITE_FAILED',
      });
    }

    if (out.hold > 0) {
      logInfo(context, 'wallet.hold_released', {
        operation: 'cancel',
        rideId,
        amountCentavos: out.hold,
      });
    }
    logInfo(context, 'ride.cancelled', {
      operation: 'cancel',
      rideId,
      fromStatus: out.priorStatus,
      toStatus: C.RIDE_STATUS.CANCELLED,
      callerRole: out.role,
      reasonCode: out.reasonCode,
      cancellationStage: out.stage,
      cancellationFeeCentavos: 0,
      notificationQueued: Boolean(out.notificationId),
    });

    if (out.priorStatus !== C.RIDE_STATUS.SEARCHING) {
      const signal = cancellationRisk(out.priorStatus, out.role, out.reasonCode);
      const actorId = signal.actorType === riskC.ACTOR_TYPE.PASSENGER
        ? out.passengerId
        : out.driverId;
      if (actorId) {
        await bestEffortRiskSignal({
          db,
          clock,
          context,
          actorType: signal.actorType,
          actorId,
          reasonCode: signal.reasonCode,
          severity: signal.severity,
          recommendedAction: signal.recommendedAction,
          sourceType: 'ride',
          sourceId: rideId,
          eventKey: `cancel_${out.reasonCode}`,
          metadata: {
            rideStatus: out.priorStatus,
            vehicleType: out.vehicleType,
            cancelledBy: out.role,
            holdCentavos: out.hold,
          },
        });
      }
    }
  }

  return {
    rideId,
    status: C.RIDE_STATUS.CANCELLED,
    cancelledBy: out.role,
    cancelReasonCode: out.reasonCode,
    cancellationStage: out.cancellationStage || out.stage,
    cancellationFeeCentavos: 0,
    replay: out.replay === true,
  };
}

module.exports = {
  cancelRide,
  cancellationArgs,
  cancellationActor,
  assertCancellationAllowed,
  cancellationRisk,
};