// @ts-check
// Secure ride lifecycle. Every mutation is authenticated, ownership-checked,
// state-guarded, transactional and idempotent. The winning driver offer mirrors
// driverRideStatus and payment presentation data so the Android driver screen
// recovers correctly after restart. The single activeRideLocations point exists
// only while the ride is moving.
//
// Commission settlement is based exclusively on the amount frozen/held when the
// offer was accepted. A later promotion change cannot erase an
// already-earned DriveLocal commission.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateIdentifier,
  validateIdempotencyKey,
  validateNonEmptyString,
} = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const { writeAuditLog } = require('../audit/auditLog');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const { buildPixPayload } = require('../pix/pixBrCode');
const { normalizePixKey } = require('../pix/pixKey');
const { bestEffortRiskSignal } = require('../risk/riskEngine');
const riskC = require('../risk/constants');
const C = require('./constants');

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function requireAuthUid(request, action) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: `${action} without authentication`,
    });
  }
  return uid;
}

function baseArgs(request) {
  const payload = assertShape(request?.data, {
    required: ['rideId', 'idempotencyKey'],
    optional: ['reasonCode'],
  });
  return {
    rideId: validateIdentifier(payload.rideId, 'rideId'),
    idempotencyKey: validateIdempotencyKey(payload.idempotencyKey),
    reasonCode: payload.reasonCode != null
      ? validateNonEmptyString(payload.reasonCode, 'reasonCode').slice(0, 40)
      : null,
  };
}

function setDriverOfferStatusTx(tx, db, rideId, driverId, driverRideStatus, extra = {}) {
  if (!driverId) return;
  tx.set(
    db.collection(C.DRIVER_OFFERS).doc(`${rideId}_${driverId}`),
    { driverRideStatus, ...extra, updatedAt: ts() },
    { merge: true }
  );
}

function clearActiveRideLocationTx(tx, db, rideId) {
  tx.delete(db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(rideId));
}

// The hold is the maximum commission authorized for this ride. A final fare
// adjustment may reduce the capture, but can never capture more than this amount.
function commissionSettlementFromRide(ride) {
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

async function markDriverArrived({ db, request, context, clock }) {
  const driverId = requireAuthUid(request, 'arrive');
  const { rideId } = baseArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
      });
    }
    const ride = snap.data() || {};
    if (ride.acceptedDriverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: 'not the accepted driver' });
    }
    if (ride.status === C.RIDE_STATUS.DRIVER_ARRIVED) return { replay: true, ride };
    if (ride.status !== C.RIDE_STATUS.ASSIGNED) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `arrive from ${ride.status}`,
      });
    }
    const nowMs = clock.now();
    tx.set(rideRef, {
      status: C.RIDE_STATUS.DRIVER_ARRIVED,
      driverArrivedAtMs: nowMs,
      driverArrivedAt: ts(),
      updatedAt: ts(),
    }, { merge: true });
    setDriverOfferStatusTx(tx, db, rideId, driverId, C.RIDE_STATUS.DRIVER_ARRIVED);
    enqueueEventTx(tx, db, buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
      recipientUid: ride.passengerId,
      recipientRole: 'passenger',
      route: '/driver-accepted',
      traceId: context?.traceId,
      nowMs,
    }));
    return { replay: false, ride };
  });

  if (!out.replay) {
    logInfo(context, 'ride.arrived', {
      operation: 'arrive',
      rideId,
      fromStatus: 'assigned',
      toStatus: 'driver_arrived',
      callerRole: 'driver',
    });
  }
  return { rideId, status: C.RIDE_STATUS.DRIVER_ARRIVED };
}

async function startRide({ db, request, context, clock }) {
  const driverId = requireAuthUid(request, 'start');
  const { rideId } = baseArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
      });
    }
    const ride = snap.data() || {};
    if (ride.acceptedDriverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: 'not the accepted driver' });
    }
    if (ride.status === C.RIDE_STATUS.IN_PROGRESS) return { replay: true, ride };
    if (ride.status !== C.RIDE_STATUS.DRIVER_ARRIVED) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `start from ${ride.status}`,
      });
    }
    const nowMs = clock.now();
    tx.set(rideRef, {
      status: C.RIDE_STATUS.IN_PROGRESS,
      startedAtMs: nowMs,
      startedAt: ts(),
      updatedAt: ts(),
    }, { merge: true });
    setDriverOfferStatusTx(tx, db, rideId, driverId, C.RIDE_STATUS.IN_PROGRESS, {
      exactDestination: {
        lat: ride.destination.lat,
        lng: ride.destination.lng,
        label: ride.destination.label || null,
      },
    });
    enqueueEventTx(tx, db, buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_STARTED,
      recipientUid: ride.passengerId,
      recipientRole: 'passenger',
      route: '/driver-accepted',
      offerId: `${rideId}_${driverId}`,
      traceId: context?.traceId,
      nowMs,
    }));
    return { replay: false, ride };
  });

  if (!out.replay) {
    logInfo(context, 'ride.started', {
      operation: 'start',
      rideId,
      fromStatus: 'driver_arrived',
      toStatus: 'in_progress',
      callerRole: 'driver',
    });
    logInfo(context, 'ride.destination_revealed', {
      operation: 'start',
      rideId,
      offerId: `${rideId}_${driverId}`,
    });
  }
  return { rideId, status: C.RIDE_STATUS.IN_PROGRESS };
}

async function finishRide({ db, request, context, clock }) {
  const driverId = requireAuthUid(request, 'finish');
  const { rideId } = baseArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);

  // Newer records keep Pix data in privateDriverData. Older/current mobile builds
  // may still have it on drivers/{uid}; keep a traceable compatibility fallback
  // until a migration moves every record to the private collection.
  const [pixSnap, driverSnap] = await Promise.all([
    db.collection(C.PRIVATE_DRIVER_DATA).doc(driverId).get(),
    db.collection(C.DRIVERS).doc(driverId).get(),
  ]);
  const pix = pixSnap.exists ? pixSnap.data() || {} : {};
  const driverProfile = driverSnap.exists ? driverSnap.data() || {} : {};

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
      });
    }
    const ride = snap.data() || {};
    if (ride.acceptedDriverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: 'not the accepted driver' });
    }
    if (ride.status === C.RIDE_STATUS.AWAITING_PAYMENT) return { replay: true, ride };
    if (ride.status !== C.RIDE_STATUS.IN_PROGRESS) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `finish from ${ride.status}`,
      });
    }

    const pixCandidate = pix.pixKey
      ? {
          key: pix.pixKey,
          keyType: pix.pixKeyType || null,
          source: 'private_driver_data',
        }
      : driverProfile.pixKey
        ? {
            key: driverProfile.pixKey,
            keyType: driverProfile.pixKeyType || null,
            source: 'driver_profile_compat',
          }
        : ride.driverPixKey
          ? {
              key: ride.driverPixKey,
              keyType: ride.driverPixKeyType || null,
              source: 'ride_snapshot_compat',
            }
          : { key: null, keyType: null, source: 'missing' };
    const pixKeySource = pixCandidate.source;
    const normalizedPix = normalizePixKey(pixCandidate.key, pixCandidate.keyType);
    if (!normalizedPix.valid) {
      throw new AppError(ERROR_CODES.PIX_KEY_INVALID, {
        internalMessage: `invalid Pix key for driver ${driverId}`,
        safeMetadata: {
          pixKeySource,
          reason: normalizedPix.reasonCode || 'PIX_KEY_INVALID',
        },
      });
    }
    const pixKey = normalizedPix.key;

    const nowMs = clock.now();
    const finalFareCentavos = Number(ride.estimatedFareCentavos || 0);
    const finalCommissionCentavos = Number(ride.estimatedCommissionCentavos || 0);
    const payload = buildPixPayload({
      pixKey,
      amountCentavos: finalFareCentavos,
      merchantName: pix.pixOwnerName
        || pix.fullName
        || driverProfile.fullName
        || driverProfile.displayName
        || 'DriveLocal',
      city: 'Horizonte',
      txid: `DL${rideId}`.slice(0, 25),
    });

    tx.set(rideRef, {
      status: C.RIDE_STATUS.AWAITING_PAYMENT,
      awaitingPaymentAtMs: nowMs,
      finalFareCentavos,
      finalCommissionCentavos,
      paymentAmountCentavos: finalFareCentavos,
      paymentPixPayload: payload,
      updatedAt: ts(),
    }, { merge: true });
    setDriverOfferStatusTx(tx, db, rideId, driverId, C.RIDE_STATUS.AWAITING_PAYMENT, {
      awaitingPaymentAtMs: nowMs,
      paymentAmountCentavos: finalFareCentavos,
      paymentPixPayload: payload,
    });
    clearActiveRideLocationTx(tx, db, rideId);
    enqueueEventTx(tx, db, buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_AWAITING_PAYMENT,
      recipientUid: ride.passengerId,
      recipientRole: 'passenger',
      route: '/pix-payment',
      traceId: context?.traceId,
      nowMs,
    }));
    return { replay: false, ride, finalFareCentavos, pixKeySource };
  });

  if (!out.replay) {
    logInfo(context, 'ride.pix_charge_created', {
      operation: 'finish',
      rideId,
      amountCentavos: out.finalFareCentavos,
      pixKeySource: out.pixKeySource,
    });
    logInfo(context, 'ride.awaiting_payment', {
      operation: 'finish',
      rideId,
      fromStatus: 'in_progress',
      toStatus: 'awaiting_payment',
      callerRole: 'driver',
      amountCentavos: out.finalFareCentavos,
    });
  }
  return { rideId, status: C.RIDE_STATUS.AWAITING_PAYMENT };
}

async function markPassengerPixSent({ db, request, context, clock }) {
  const passengerId = requireAuthUid(request, 'mark_paid');
  const { rideId } = baseArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
      });
    }
    const ride = snap.data() || {};
    if (ride.passengerId !== passengerId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: 'not the ride passenger' });
    }
    if (ride.status === C.RIDE_STATUS.PAYMENT_MARKED_SENT) return { replay: true, ride };
    if (ride.status !== C.RIDE_STATUS.AWAITING_PAYMENT) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `mark_paid from ${ride.status}`,
      });
    }
    const nowMs = clock.now();
    tx.set(rideRef, {
      status: C.RIDE_STATUS.PAYMENT_MARKED_SENT,
      passengerMarkedPaidAtMs: nowMs,
      updatedAt: ts(),
    }, { merge: true });
    setDriverOfferStatusTx(tx, db, rideId, ride.acceptedDriverId, C.RIDE_STATUS.PAYMENT_MARKED_SENT, {
      passengerMarkedPaidAtMs: nowMs,
    });
    clearActiveRideLocationTx(tx, db, rideId);
    enqueueEventTx(tx, db, buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_PAYMENT_MARKED_SENT,
      recipientUid: ride.acceptedDriverId,
      recipientRole: 'driver',
      route: '/active-ride',
      traceId: context?.traceId,
      nowMs,
    }));
    return { replay: false };
  });

  if (!out.replay) {
    logInfo(context, 'ride.payment_marked_sent', {
      operation: 'mark_paid',
      rideId,
      fromStatus: 'awaiting_payment',
      toStatus: 'payment_marked_sent',
      callerRole: 'passenger',
    });
  }
  return { rideId, status: C.RIDE_STATUS.PAYMENT_MARKED_SENT };
}

async function confirmDriverPixReceived({ db, request, context, clock }) {
  const driverId = requireAuthUid(request, 'confirm_paid');
  const { rideId } = baseArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const driverRef = db.collection(C.DRIVERS).doc(driverId);
  const holdRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_hold`);
  const captureRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_capture`);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
      });
    }
    const ride = snap.data() || {};
    if (ride.acceptedDriverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: 'not the accepted driver' });
    }
    if (ride.status === C.RIDE_STATUS.COMPLETED) {
      return {
        replay: true,
        ride,
        captured: Number(ride.commissionCapturedCentavos || 0),
      };
    }
    if (
      ride.status !== C.RIDE_STATUS.AWAITING_PAYMENT
      && ride.status !== C.RIDE_STATUS.PAYMENT_MARKED_SENT
    ) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `confirm_paid from ${ride.status}`,
      });
    }

    const driverSnap = await tx.get(driverRef);
    const driver = driverSnap.exists ? driverSnap.data() || {} : {};
    const nowMs = clock.now();
    const settlement = commissionSettlementFromRide(ride);
    const balance = Math.max(
      0,
      Number(driver.walletBalanceCentavos || 0) - settlement.captured
    );
    const held = Math.max(
      0,
      Number(driver.walletHeldCentavos || 0) - settlement.originalHold
    );
    const available = Math.max(
      0,
      Number(driver.walletAvailableCentavos || 0) + settlement.released
    );

    const driverUpdate = {
      walletBalanceCentavos: balance,
      walletHeldCentavos: held,
      walletAvailableCentavos: available,
      activeRideId: null,
      completedRideCount: Number(driver.completedRideCount || 0) + 1,
      updatedAt: ts(),
    };
    tx.set(driverRef, driverUpdate, { merge: true });
    tx.set(rideRef, {
      status: C.RIDE_STATUS.COMPLETED,
      completedAtMs: nowMs,
      completedAt: ts(),
      commissionCapturedCentavos: settlement.captured,
      holdReleasedCentavos: settlement.released,
      commissionSettlementStatus: settlement.originalHold > 0 ? 'captured' : 'free',
      updatedAt: ts(),
    }, { merge: true });
    setDriverOfferStatusTx(tx, db, rideId, driverId, C.RIDE_STATUS.COMPLETED, {
      completedAtMs: nowMs,
    });
    clearActiveRideLocationTx(tx, db, rideId);

    if (settlement.originalHold > 0) {
      tx.set(holdRef, {
        status: 'settled',
        capturedCentavos: settlement.captured,
        releasedCentavos: settlement.released,
        settledAtMs: nowMs,
        settledAt: ts(),
      }, { merge: true });
      tx.set(captureRef, {
        driverId,
        rideId,
        type: 'commission_capture',
        amountCentavos: settlement.captured,
        releasedCentavos: settlement.released,
        status: 'captured',
        policyVersion: ride.commissionPolicySnapshot?.policyVersion || 'legacy-hold',
        createdAtMs: nowMs,
        createdAt: ts(),
        traceId: context?.traceId,
      });
    }

    if (ride.passengerId) {
      tx.set(db.collection(C.PASSENGERS).doc(ride.passengerId), {
        activeRideId: null,
        updatedAt: ts(),
      }, { merge: true });
    }

    // Both users land on the payment context first, see the same green success
    // confirmation, then each app leaves that screen after five seconds.
    enqueueEventTx(tx, db, buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_COMPLETED,
      recipientUid: ride.passengerId,
      recipientRole: 'passenger',
      route: '/pix-payment',
      traceId: context?.traceId,
      nowMs,
    }));
    enqueueEventTx(tx, db, buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_COMPLETED,
      recipientUid: driverId,
      recipientRole: 'driver',
      route: '/active-ride',
      traceId: context?.traceId,
      nowMs,
    }));
    return { replay: false, ...settlement };
  });

  if (!out.replay) {
    await writeAuditLog(db, {
      actorUid: driverId,
      actorType: 'driver',
      action: 'ride_completed',
      targetType: 'ride',
      targetId: rideId,
      traceId: context?.traceId,
      afterSummary: {
        commissionCapturedCentavos: out.captured,
        holdReleasedCentavos: out.released,
        originalHoldCentavos: out.originalHold,
      },
    }, clock);
    logInfo(context, 'wallet.commission_captured', {
      operation: 'confirm_paid',
      rideId,
      amountCentavos: out.captured,
    });
    if (out.released > 0) {
      logInfo(context, 'wallet.hold_released', {
        operation: 'confirm_paid',
        rideId,
        amountCentavos: out.released,
      });
    }
    logInfo(context, 'ride.completed', {
      operation: 'confirm_paid',
      rideId,
      toStatus: 'completed',
      callerRole: 'driver',
    });
  }
  return {
    rideId,
    status: C.RIDE_STATUS.COMPLETED,
    commissionCapturedCentavos: out.captured,
  };
}

function cancellationRisk(priorStatus, isPassenger, reasonCode) {
  const arrived = priorStatus === C.RIDE_STATUS.DRIVER_ARRIVED;
  const noShow = !isPassenger
    && arrived
    && /no_show|nao_compareceu|passageiro_ausente/i.test(String(reasonCode || ''));
  if (noShow) {
    return {
      actorType: riskC.ACTOR_TYPE.PASSENGER,
      reasonCode: riskC.REASON.PASSENGER_NO_SHOW,
      severity: riskC.SEVERITY.HIGH,
      recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
    };
  }
  return {
    actorType: isPassenger ? riskC.ACTOR_TYPE.PASSENGER : riskC.ACTOR_TYPE.DRIVER,
    reasonCode: isPassenger
      ? riskC.REASON.PASSENGER_LATE_CANCELLATION
      : riskC.REASON.DRIVER_LATE_CANCELLATION,
    severity: arrived ? riskC.SEVERITY.HIGH : riskC.SEVERITY.MEDIUM,
    recommendedAction: arrived ? riskC.ACTION.REQUIRE_REVIEW : riskC.ACTION.WARN,
  };
}

async function cancelRide({ db, request, context, clock }) {
  const uid = requireAuthUid(request, 'cancel');
  const { rideId, reasonCode } = baseArgs(request);
  if (!reasonCode) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'reasonCode required',
      safeMetadata: { field: 'reasonCode' },
    });
  }
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
      });
    }
    const ride = snap.data() || {};
    const isPassenger = ride.passengerId === uid;
    const isDriver = ride.acceptedDriverId === uid;
    if (!isPassenger && !isDriver) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: 'not a party to this ride' });
    }
    if (ride.status === C.RIDE_STATUS.CANCELLED) return { replay: true };
    const cancellable = isPassenger
      ? [C.RIDE_STATUS.SEARCHING, C.RIDE_STATUS.ASSIGNED, C.RIDE_STATUS.DRIVER_ARRIVED]
      : [C.RIDE_STATUS.ASSIGNED, C.RIDE_STATUS.DRIVER_ARRIVED];
    if (!cancellable.includes(ride.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `cancel from ${ride.status}`,
      });
    }

    const priorStatus = ride.status;
    const nowMs = clock.now();
    const hold = Number(ride.commissionHoldCentavos || 0);
    if (ride.acceptedDriverId && hold > 0) {
      const driverRef = db.collection(C.DRIVERS).doc(ride.acceptedDriverId);
      const dSnap = await tx.get(driverRef);
      const driver = dSnap.exists ? dSnap.data() || {} : {};
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

    setDriverOfferStatusTx(tx, db, rideId, ride.acceptedDriverId, C.RIDE_STATUS.CANCELLED);
    clearActiveRideLocationTx(tx, db, rideId);
    tx.set(rideRef, {
      status: C.RIDE_STATUS.CANCELLED,
      cancelledAtMs: nowMs,
      cancelledBy: isPassenger ? 'passenger' : 'driver',
      cancelReasonCode: reasonCode,
      commissionOriginalHoldCentavos: hold,
      commissionHoldCentavos: 0,
      holdReleasedCentavos: hold,
      commissionSettlementStatus: hold > 0 ? 'released' : 'free',
      updatedAt: ts(),
    }, { merge: true });
    if (ride.passengerId) {
      tx.set(db.collection(C.PASSENGERS).doc(ride.passengerId), {
        activeRideId: null,
        updatedAt: ts(),
      }, { merge: true });
    }
    const otherUid = isPassenger ? ride.acceptedDriverId : ride.passengerId;
    if (otherUid) {
      enqueueEventTx(tx, db, buildNotificationEvent({
        rideId,
        eventType: C.NOTIFICATION_EVENT.RIDE_CANCELLED,
        recipientUid: otherUid,
        recipientRole: isPassenger ? 'driver' : 'passenger',
        route: isPassenger ? '/driver-home' : '/passenger-home',
        traceId: context?.traceId,
        nowMs,
      }));
    }
    return {
      replay: false,
      hold,
      byPassenger: isPassenger,
      passengerId: ride.passengerId,
      driverId: ride.acceptedDriverId,
      priorStatus,
      vehicleType: ride.vehicleType,
    };
  });

  if (!out.replay) {
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
      toStatus: 'cancelled',
      callerRole: out.byPassenger ? 'passenger' : 'driver',
      reasonCode,
    });

    if (out.priorStatus !== C.RIDE_STATUS.SEARCHING) {
      const signal = cancellationRisk(out.priorStatus, out.byPassenger, reasonCode);
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
          eventKey: `cancel_${reasonCode}`,
          metadata: {
            rideStatus: out.priorStatus,
            vehicleType: out.vehicleType,
            cancelledBy: out.byPassenger ? 'passenger' : 'driver',
            holdCentavos: out.hold,
          },
        });
      }
    }
  }
  return { rideId, status: C.RIDE_STATUS.CANCELLED };
}

async function reportRidePaymentIssue({ db, request, context, clock }) {
  const uid = requireAuthUid(request, 'dispute');
  const { rideId, reasonCode } = baseArgs(request);
  if (!reasonCode) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'reasonCode required',
      safeMetadata: { field: 'reasonCode' },
    });
  }
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${rideId}`,
      });
    }
    const ride = snap.data() || {};
    const isPassenger = ride.passengerId === uid;
    const isDriver = ride.acceptedDriverId === uid;
    if (!isPassenger && !isDriver) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: 'not a party to this ride' });
    }
    if (ride.status === C.RIDE_STATUS.DISPUTED) return { replay: true };
    if (
      ride.status !== C.RIDE_STATUS.AWAITING_PAYMENT
      && ride.status !== C.RIDE_STATUS.PAYMENT_MARKED_SENT
    ) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `dispute from ${ride.status}`,
      });
    }

    const priorStatus = ride.status;
    const nowMs = clock.now();
    if (ride.acceptedDriverId) {
      tx.set(db.collection(C.DRIVERS).doc(ride.acceptedDriverId), {
        activeRideId: null,
        updatedAt: ts(),
      }, { merge: true });
    }
    setDriverOfferStatusTx(tx, db, rideId, ride.acceptedDriverId, C.RIDE_STATUS.DISPUTED, {
      disputedAtMs: nowMs,
      disputedBy: isPassenger ? 'passenger' : 'driver',
      disputeReasonCode: reasonCode,
    });
    clearActiveRideLocationTx(tx, db, rideId);
    tx.set(rideRef, {
      status: C.RIDE_STATUS.DISPUTED,
      disputedAtMs: nowMs,
      disputedBy: isPassenger ? 'passenger' : 'driver',
      disputeReasonCode: reasonCode,
      commissionSettlementStatus: 'disputed',
      updatedAt: ts(),
    }, { merge: true });
    const otherUid = isPassenger ? ride.acceptedDriverId : ride.passengerId;
    if (otherUid) {
      enqueueEventTx(tx, db, buildNotificationEvent({
        rideId,
        eventType: C.NOTIFICATION_EVENT.RIDE_DISPUTED,
        recipientUid: otherUid,
        recipientRole: isPassenger ? 'driver' : 'passenger',
        route: isPassenger ? '/active-ride' : '/pix-payment',
        traceId: context?.traceId,
        nowMs,
      }));
    }
    return {
      replay: false,
      byPassenger: isPassenger,
      priorStatus,
      passengerId: ride.passengerId,
      driverId: ride.acceptedDriverId,
      hold: Number(ride.commissionHoldCentavos || 0),
      vehicleType: ride.vehicleType,
    };
  });

  if (!out.replay) {
    const actorType = out.byPassenger
      ? riskC.ACTOR_TYPE.PASSENGER
      : riskC.ACTOR_TYPE.DRIVER;
    await writeAuditLog(db, {
      actorUid: uid,
      actorType,
      action: 'ride_payment_disputed',
      targetType: 'ride',
      targetId: rideId,
      reason: reasonCode,
      traceId: context?.traceId,
      afterSummary: {
        commissionSettlementStatus: 'disputed',
        commissionHoldCentavos: out.hold,
      },
    }, clock);
    logInfo(context, 'ride.disputed', {
      operation: 'dispute',
      rideId,
      fromStatus: out.priorStatus,
      toStatus: 'disputed',
      callerRole: actorType,
      reasonCode,
      amountCentavos: out.hold,
    });

    await bestEffortRiskSignal({
      db,
      clock,
      context,
      actorType,
      actorId: uid,
      reasonCode: riskC.REASON.PAYMENT_DISPUTE_OPENED,
      severity: riskC.SEVERITY.MEDIUM,
      recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
      sourceType: 'ride',
      sourceId: rideId,
      eventKey: `payment_dispute_${reasonCode}`,
      metadata: {
        rideStatus: out.priorStatus,
        paymentState: out.priorStatus,
        vehicleType: out.vehicleType,
        holdCentavos: out.hold,
      },
    });

    const patternReason = out.byPassenger && out.priorStatus === C.RIDE_STATUS.PAYMENT_MARKED_SENT
      ? riskC.REASON.PASSENGER_FALSE_PAYMENT_PATTERN
      : !out.byPassenger && out.priorStatus === C.RIDE_STATUS.PAYMENT_MARKED_SENT
        ? riskC.REASON.DRIVER_NON_RECEIPT_PATTERN
        : null;
    if (patternReason) {
      await bestEffortRiskSignal({
        db,
        clock,
        context,
        actorType,
        actorId: uid,
        reasonCode: patternReason,
        severity: riskC.SEVERITY.MEDIUM,
        recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
        sourceType: 'ride',
        sourceId: rideId,
        eventKey: `payment_pattern_${reasonCode}`,
        metadata: {
          rideStatus: out.priorStatus,
          paymentState: out.priorStatus,
          holdCentavos: out.hold,
        },
      });
    }
  }
  return { rideId, status: C.RIDE_STATUS.DISPUTED };
}

module.exports = {
  markDriverArrived,
  startRide,
  finishRide,
  markPassengerPixSent,
  confirmDriverPixReceived,
  cancelRide,
  reportRidePaymentIssue,
  clearActiveRideLocationTx,
  commissionSettlementFromRide,
  cancellationRisk,
};
