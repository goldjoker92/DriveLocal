// @ts-check
// Secure driver-arrival transition. The full ride remains unreadable to drivers;
// only safe waiting timestamps are copied to the winning private driver offer.
// The passenger notification event is created in the same transaction as arrival.
// Replays repair a missing event but never reset or resend an existing one.

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

function setSafeWaitProjectionTx(tx, offerRef, arrivedAtMs, passengerNoShowEligibleAtMs) {
  tx.set(offerRef, {
    driverRideStatus: C.RIDE_STATUS.DRIVER_ARRIVED,
    driverArrivedAtMs: arrivedAtMs,
    passengerNoShowEligibleAtMs,
    passengerNoShowWaitMs: PASSENGER_NO_SHOW_WAIT_MS,
    updatedAt: ts(),
  }, { merge: true });
}

function buildArrivalNotification({ rideId, passengerId, traceId, nowMs }) {
  return buildNotificationEvent({
    rideId,
    eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
    recipientUid: passengerId,
    recipientRole: 'passenger',
    route: '/driver-accepted',
    traceId,
    nowMs,
  });
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
    if (!ride.passengerId) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'assigned ride has no passenger recipient',
        safeMetadata: { status: ride.status },
      });
    }

    const nowMs = Number(clock.now());
    const notificationEvent = buildArrivalNotification({
      rideId,
      passengerId: ride.passengerId,
      traceId: context?.traceId,
      nowMs,
    });
    const notificationRef = db.collection(C.NOTIFICATION_EVENTS).doc(notificationEvent.id);
    const notificationSnap = await tx.get(notificationRef);
    const notificationEventCreated = !notificationSnap.exists;

    if (ride.status === C.RIDE_STATUS.DRIVER_ARRIVED) {
      // Backfill private wait timing for rides that crossed a deployment boundary.
      // If an old malformed record has no arrival timestamp, start a fresh full wait
      // period rather than allowing an immediate passenger-no-show cancellation.
      const existingArrivedAtMs = Number(ride.driverArrivedAtMs || 0);
      const arrivedAtMs = existingArrivedAtMs > 0 ? existingArrivedAtMs : nowMs;
      const passengerNoShowEligibleAtMs = arrivedAtMs + PASSENGER_NO_SHOW_WAIT_MS;
      if (existingArrivedAtMs <= 0) {
        tx.set(rideRef, {
          driverArrivedAtMs: arrivedAtMs,
          driverArrivedAt: ts(),
          passengerNoShowEligibleAtMs,
          updatedAt: ts(),
        }, { merge: true });
      }
      setSafeWaitProjectionTx(tx, offerRef, arrivedAtMs, passengerNoShowEligibleAtMs);
      if (notificationEventCreated) enqueueEventTx(tx, db, notificationEvent);
      return {
        replay: true,
        arrivedAtMs,
        passengerNoShowEligibleAtMs,
        notificationEventCreated,
      };
    }
    if (ride.status !== C.RIDE_STATUS.ASSIGNED) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `driver arrival from status ${ride.status}`,
        safeMetadata: { status: ride.status },
      });
    }

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
    setSafeWaitProjectionTx(tx, offerRef, nowMs, passengerNoShowEligibleAtMs);

    // A pre-existing deterministic event is never reset to pending. This preserves
    // at-most-once delivery if a stale client repeats the arrival action.
    if (notificationEventCreated) enqueueEventTx(tx, db, notificationEvent);

    return {
      replay: false,
      arrivedAtMs: nowMs,
      passengerNoShowEligibleAtMs,
      notificationEventCreated,
    };
  });

  logInfo(context, out.replay ? 'ride.arrived_replayed' : 'ride.arrived', {
    operation: 'arrive',
    rideId,
    fromStatus: out.replay ? C.RIDE_STATUS.DRIVER_ARRIVED : C.RIDE_STATUS.ASSIGNED,
    toStatus: C.RIDE_STATUS.DRIVER_ARRIVED,
    callerRole: 'driver',
    noShowWaitMs: PASSENGER_NO_SHOW_WAIT_MS,
    projectionBackfilled: out.replay === true,
    notificationEventCreated: out.notificationEventCreated === true,
    notificationEventRecovered: out.replay === true && out.notificationEventCreated === true,
  });

  return {
    rideId,
    status: C.RIDE_STATUS.DRIVER_ARRIVED,
    driverArrivedAtMs: out.arrivedAtMs,
    passengerNoShowEligibleAtMs: out.passengerNoShowEligibleAtMs,
    replay: out.replay === true,
    passengerScreenUpdated: true,
    notificationEventReady: true,
    notificationEventCreated: out.notificationEventCreated === true,
  };
}

module.exports = {
  markDriverArrived,
  arrivalArgs,
  setSafeWaitProjectionTx,
  buildArrivalNotification,
};