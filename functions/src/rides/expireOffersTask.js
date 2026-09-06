// @ts-check
// Server-authoritative offer expiry. A Cloud Task is scheduled once per ride when
// targeted offers are created, so expiry does not depend on a driver's app being
// open, a notification being tapped, or a client timer continuing to run.

const admin = require('firebase-admin');
const { onTaskDispatched } = require('firebase-functions/tasks');
const { logInfo, logWarning } = require('../logging/logger');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const C = require('./constants');

const REGION = 'southamerica-east1';

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/**
 * Idempotently closes expired offers for one ride and ends the search only when
 * the ride is still searching and no live offer remains. The ride, passenger and
 * offers are read before any write so acceptance and expiry cannot both win.
 *
 * @param {{db:object, rideId:string, nowMs:number, context?:object}} args
 */
async function expireRideOffers({ db, rideId, nowMs, context }) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const offersQuery = db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId);

  const result = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) {
      return {
        outcome: 'ride_missing',
        expiredOfferCount: 0,
        liveOfferCount: 0,
        passengerStateCleared: false,
        passengerNotified: false,
      };
    }

    const ride = rideSnap.data() || {};
    if (ride.status !== C.RIDE_STATUS.SEARCHING) {
      return {
        outcome: `ride_${ride.status}`,
        expiredOfferCount: 0,
        liveOfferCount: 0,
        passengerStateCleared: false,
        passengerNotified: false,
      };
    }

    const passengerRef = ride.passengerId
      ? db.collection(C.PASSENGERS).doc(ride.passengerId)
      : null;
    const passengerSnap = passengerRef ? await tx.get(passengerRef) : null;
    const offersSnap = await tx.get(offersQuery);
    const expiredDocs = [];
    let liveOfferCount = 0;

    offersSnap.forEach((doc) => {
      const offer = doc.data() || {};
      if (offer.status !== C.OFFER_STATUS.OFFERED) return;
      if (Number(offer.expiresAtMs || 0) > nowMs) liveOfferCount += 1;
      else expiredDocs.push(doc);
    });

    expiredDocs.forEach((doc) => {
      tx.set(doc.ref, {
        status: C.OFFER_STATUS.CLOSED,
        declineReason: 'expired_server',
        declinedAtMs: nowMs,
        declinedAt: ts(),
        updatedAt: ts(),
      }, { merge: true });
    });

    if (liveOfferCount > 0) {
      return {
        outcome: 'live_offers_remain',
        expiredOfferCount: expiredDocs.length,
        liveOfferCount,
        passengerStateCleared: false,
        passengerNotified: false,
      };
    }

    tx.set(rideRef, {
      status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
      reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS,
      updatedAt: ts(),
    }, { merge: true });

    let passengerStateCleared = false;
    if (
      passengerRef
      && passengerSnap?.exists
      && (passengerSnap.data() || {}).activeRideId === rideId
    ) {
      tx.set(
        passengerRef,
        { activeRideId: null, updatedAt: ts() },
        { merge: true }
      );
      passengerStateCleared = true;
    }

    // Tell the passenger the search is over. Enqueued in the SAME transaction as
    // the status change, like every other ride notification, so a failed
    // transaction can never leave a "no driver" push without the matching ride
    // state. Routed to /passenger-home, which every installed client version
    // already allows and which needs no rideId - so this reaches old builds too.
    let passengerNotified = false;
    if (ride.passengerId) {
      enqueueEventTx(
        tx,
        db,
        buildNotificationEvent({
          rideId,
          eventType: C.NOTIFICATION_EVENT.RIDE_NO_DRIVER,
          recipientUid: ride.passengerId,
          recipientRole: 'passenger',
          route: '/passenger-home',
          traceId: (context && context.traceId) || null,
          nowMs,
        })
      );
      passengerNotified = true;
    }

    return {
      outcome: 'search_closed',
      expiredOfferCount: expiredDocs.length,
      liveOfferCount: 0,
      passengerStateCleared,
      passengerNotified,
    };
  });

  logInfo(context, 'ride.offer_expiry.completed', {
    operation: 'expire_offers',
    rideId,
    expiredOfferCount: result.expiredOfferCount,
    liveOfferCount: result.liveOfferCount,
    passengerStateCleared: result.passengerStateCleared,
    passengerNotified: result.passengerNotified,
    outcome: result.outcome,
  });

  return { rideId, ...result };
}

const expireRideOffersTask = onTaskDispatched(
  {
    region: REGION,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 5 },
    rateLimits: { maxConcurrentDispatches: 50 },
  },
  async (request) => {
    const rideId = request?.data?.rideId;
    if (typeof rideId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(rideId)) {
      logWarning({}, 'ride.offer_expiry.invalid_payload', { operation: 'expire_offers' });
      return { outcome: 'invalid_payload' };
    }

    return expireRideOffers({
      db: admin.firestore(),
      rideId,
      nowMs: Date.now(),
      context: { traceId: request?.data?.traceId || null },
    });
  }
);

module.exports = { expireRideOffersTask, expireRideOffers };
