// @ts-check
// createTargetedOffers — writes one deterministic offer document per eligible
// driver: driverOffers/{rideId}_{driverId}. Deterministic ids make dispatch
// idempotent: re-running for the same ride can never create duplicate offers.
// Documents carry only a SAFE pickup preview (coarsened coordinates + generic
// label). The exact address/coordinates are delivered to the winner at acceptance.

const admin = require('firebase-admin');
const { getFunctions } = require('firebase-admin/functions');
const { buildNotificationEvent, enqueueEvent } = require('../notifications/events');
const C = require('./constants');

const REGION = 'southamerica-east1';
const EXPIRY_TASK_NAME = `locations/${REGION}/functions/expireRideOffersTask`;

// Coarsen a coordinate to ~110 m so a pre-acceptance offer never reveals the
// passenger's exact location.
function coarse(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function offerId(rideId, driverId) {
  return `${rideId}_${driverId}`;
}

function pickupPreview(pickup) {
  return {
    // Never copy the passenger's street/number before the driver accepts.
    label: 'Região do embarque',
    approxLat: coarse(pickup.lat),
    approxLng: coarse(pickup.lng),
  };
}

async function scheduleOfferExpiry({ rideId, expiresAtMs, traceId }) {
  const queue = getFunctions().taskQueue(EXPIRY_TASK_NAME);
  await queue.enqueue(
    { rideId, traceId: traceId || null },
    {
      scheduleTime: new Date(expiresAtMs + 1000),
      dispatchDeadlineSeconds: 60,
      id: `expire-${rideId}`,
    }
  );
}

/**
 * @param {{db:object, ride:object, eligible:Array<object>, offerTtlSeconds:number,
 *          traceId?:string, clock:{now:()=>number}}} args
 * @returns {Promise<{createdCount:number, offerIds:string[]}>}
 */
async function createTargetedOffers({ db, ride, eligible, offerTtlSeconds, traceId, clock }) {
  const nowMs = clock.now();
  const expiresAtMs = nowMs + offerTtlSeconds * 1000;
  const preview = pickupPreview(ride.pickup);
  const offerIds = [];

  // Persist every deterministic offer first. If scheduling the authoritative
  // expiry fails, dispatch fails closed rather than leaving an endless search.
  for (const cand of eligible) {
    const id = offerId(ride.rideId, cand.driverId);
    await db.collection(C.DRIVER_OFFERS).doc(id).set({
      rideId: ride.rideId,
      driverId: cand.driverId,
      serviceAreaId: ride.serviceAreaId,
      vehicleType: ride.vehicleType,
      estimatedFareCentavos: ride.estimatedFareCentavos,
      pickupPreview: preview,
      distanceToPickupMeters: cand.distanceToPickupMeters,
      status: C.OFFER_STATUS.OFFERED,
      driverRideStatus: null,
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAtMs,
      traceId: traceId || null,
    });
    offerIds.push(id);
  }

  await scheduleOfferExpiry({ rideId: ride.rideId, expiresAtMs, traceId });

  // Notify only after the server expiry task is safely queued.
  for (let index = 0; index < eligible.length; index += 1) {
    const cand = eligible[index];
    const id = offerIds[index];
    await enqueueEvent(
      db,
      buildNotificationEvent({
        rideId: ride.rideId,
        eventType: C.NOTIFICATION_EVENT.OFFER_CREATED,
        recipientUid: cand.driverId,
        recipientRole: 'driver',
        route: '/ride-request',
        offerId: id,
        dedupeSuffix: cand.driverId,
        traceId: traceId || null,
        nowMs,
      })
    );
  }

  return { createdCount: offerIds.length, offerIds };
}

module.exports = {
  createTargetedOffers,
  offerId,
  pickupPreview,
  scheduleOfferExpiry,
  EXPIRY_TASK_NAME,
};
