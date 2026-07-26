// @ts-check
// Secure driver-arrival transition. The full ride remains unreadable to drivers;
// only safe waiting timestamps are copied to the winning private driver offer.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateIdentifier,
  validateIdempotencyKey,
} = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const C = require('./constants');
const { PASSENGER_NO_SHOW_WAIT_MS } = require('./cancellationPolicy');

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function arrivalArgs(request) {
  const payload = assertShape(request?.data, {
    required: ['rideId', 'idempotencyKey'],
    optional: [],
  });
  return {
    rideId: validateIdentifier(payload.rideId, 'rideId'),
    idempotencyKey: validateIdempotencyKey(payload.idempotencyKey),
  };
}

async function markDriverArrived({ db, request, context, clock }) {
  const driverId = request?.auth?.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'driver arrival without authentication',
    });
  }
  const { rideId } = arrivalArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const offerRef = db.collection(C.DRIVER_OFFERS).doc(`${rideId}_${driverId}`);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: 'ride not found for driver arrival',
      });
    }
    const ride = snap.data() || {};
    if (ride.acceptedDriverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, {
        internalMessage: 'caller is not the accepted driver',
      });
    }

    if (ride.status === C.RIDE_STATUS.DRIVER_ARRIVED) {
      const arrivedAtMs = Number(ride.driverArrivedAtMs || 0) || null;
      return {
        replay: true,
        arrivedAtMs,
        passengerNoShowEligibleAtMs: arrivedAtMs == null
          ? null
          : arrivedAtMs + PASSENGER_NO_SHOW_WAIT_MS,
      };
    }
    if (ride.status !== C.RIDE_STATUS.ASSIGNED) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `driver arrival from status ${ride.status}`,
        safeMetadata: { status: ride.status },
      });
    }

    const nowMs = Number(clock.now());
    const passengerNoShowEligibleAtMs = nowMs + PASSENGER_NO_SHOW_WAIT_MS;
    tx.set(rideRef, {
      status: C.RIDE_STATUS.DRIVER_ARRIVED,
      driverArrivedAtMs: nowMs,
      driverArrivedAt: ts(),
      passengerNoShowEligibleAtMs,
      updatedAt: ts(),
    }, { merge: true });

    // This offer is readable only by its driver. No coordinates, passenger PII or
    // destination are added — only the status and server-authoritative wait times.
    tx.set(offerRef, {
      driverRideStatus: C.RIDE_STATUS.DRIVER_ARRIVED,
      driverArrivedAtMs: nowMs,
      passengerNoShowEligibleAtMs,
      passengerNoShowWaitMs: PASSENGER_NO_SHOW_WAIT_MS,
      updatedAt: ts(),
    }, { merge: true });

    enqueueEventTx(tx, db, buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
      recipientUid: ride.passengerId,
      recipientRole: 'passenger',
      route: '/driver-accepted',
      traceId: context?.traceId,
      nowMs,
    }));

    return {
      replay: false,
      arrivedAtMs: nowMs,
      passengerNoShowEligibleAtMs,
    };
  });

  if (!out.replay) {
    logInfo(context, 'ride.arrived', {
      operation: 'arrive',
      rideId,
      fromStatus: C.RIDE_STATUS.ASSIGNED,
      toStatus: C.RIDE_STATUS.DRIVER_ARRIVED,
      callerRole: 'driver',
      noShowWaitMs: PASSENGER_NO_SHOW_WAIT_MS,
    });
  }

  return {
    rideId,
    status: C.RIDE_STATUS.DRIVER_ARRIVED,
    driverArrivedAtMs: out.arrivedAtMs,
    passengerNoShowEligibleAtMs: out.passengerNoShowEligibleAtMs,
    replay: out.replay === true,
  };
}

module.exports = {
  markDriverArrived,
  arrivalArgs,
};