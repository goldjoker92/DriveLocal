// @ts-check
// Server-authoritative offer expiry. A Cloud Task is scheduled once per ride when
// targeted offers are created, so expiry does not depend on a driver's app being
// open, a notification being tapped, or a client timer continuing to run.

const admin = require('firebase-admin');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { logInfo, logWarning } = require('../logging/logger');
const C = require('./constants');

const REGION = 'southamerica-east1';

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

/**
 * Idempotently closes expired offers for one ride and ends the search only when
 * the ride is still searching and no live offer remains.
 *
 * @param {{db:object, rideId:string, nowMs:number, context?:object}} args
 */
async function expireRideOffers({ db, rideId, nowMs, context }) {
  const offersSnap = await db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId).get();
  const expiredRefs = [];
  let liveOfferCount = 0;

  offersSnap.forEach((doc) => {
    const offer = doc.data() || {};
    if (offer.status !== C.OFFER_STATUS.OFFERED) return;
    if (Number(offer.expiresAtMs || 0) > nowMs) liveOfferCount += 1;
    else expiredRefs.push(doc.ref);
  });

  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const outcome = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) return 'ride_missing';
    const ride = rideSnap.data() || {};
    if (ride.status !== C.RIDE_STATUS.SEARCHING) return `ride_${ride.status}`;

    expiredRefs.forEach((ref) => {
      tx.set(ref, {
        status: C.OFFER_STATUS.CLOSED,
        declineReason: 'expired_server',
        declinedAtMs: nowMs,
        declinedAt: ts(),
        updatedAt: ts(),
      }, { merge: true });
    });

    if (liveOfferCount > 0) return 'live_offers_remain';

    tx.set(rideRef, {
      status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
      reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS,
      updatedAt: ts(),
    }, { merge: true });
    return 'search_closed';
  });

  logInfo(context, 'ride.offer_expiry.completed', {
    operation: 'expire_offers',
    rideId,
    expiredOfferCount: expiredRefs.length,
    liveOfferCount,
    outcome,
  });

  return { rideId, expiredOfferCount: expiredRefs.length, liveOfferCount, outcome };
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
