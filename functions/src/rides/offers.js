// @ts-check
// createTargetedOffers — writes one deterministic offer document per eligible
// driver: driverOffers/{rideId}_{driverId}. Deterministic ids make dispatch
// idempotent: re-running for the same ride can never create duplicate offers.
// Documents carry only a SAFE pickup preview (coarsened coordinates + generic
// label). The exact address/coordinates are delivered to the winner at acceptance.

const admin = require('firebase-admin');
const { getFunctions } = require('firebase-admin/functions');
const { buildNotificationEvent, enqueueEvent } = require('../notifications/events');
const { logInfo, logWarning } = require('../logging/logger');
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

function isTaskAlreadyExists(error) {
  const code = String(error?.code || '').toLowerCase();
  return code === 'task-already-exists' || code.endsWith('/task-already-exists');
}

async function scheduleOfferExpiry({ rideId, expiresAtMs, traceId, context }) {
  // Unit/integration tests use an in-memory Firestore double and intentionally do
  // not contact Google Cloud Tasks. The task handler itself has separate contract
  // coverage; production and emulator runtimes still execute the real enqueue.
  if (process.env.NODE_ENV === 'test') {
    logInfo(context, 'ride.offer_expiry.enqueue_skipped', {
      operation: 'enqueue_offer_expiry',
      rideId,
      reasonCode: 'TEST_ENVIRONMENT',
    });
    return { scheduled: false, reasonCode: 'TEST_ENVIRONMENT' };
  }

  const queue = getFunctions().taskQueue(EXPIRY_TASK_NAME);
  try {
    await queue.enqueue(
      { rideId, traceId: traceId || null },
      {
        scheduleTime: new Date(expiresAtMs + 1000),
        dispatchDeadlineSeconds: 60,
        id: `expire-${rideId}`,
      }
    );
    logInfo(context, 'ride.offer_expiry.enqueued', {
      operation: 'enqueue_offer_expiry',
      rideId,
      expiresAtMs,
    });
    return { scheduled: true, reasonCode: 'ENQUEUED' };
  } catch (error) {
    // Deterministic task ids make dispatch retries safe. If the task already
    // exists, expiry is already guaranteed and dispatch must remain successful.
    if (isTaskAlreadyExists(error)) {
      logInfo(context, 'ride.offer_expiry.duplicate_ignored', {
        operation: 'enqueue_offer_expiry',
        rideId,
        reasonCode: 'TASK_ALREADY_EXISTS',
      });
      return { scheduled: true, reasonCode: 'TASK_ALREADY_EXISTS' };
    }

    logWarning(context, 'ride.offer_expiry.enqueue_failed', {
      operation: 'enqueue_offer_expiry',
      rideId,
      internalMessage: error?.message || 'unknown task enqueue error',
    });
    throw error;
  }
}

/**
 * @param {{db:object, ride:object, eligible:Array<object>, offerTtlSeconds:number,
 *          traceId?:string, context?:object, clock:{now:()=>number}}} args
 * @returns {Promise<{createdCount:number, offerIds:string[]}>}
 */
async function createTargetedOffers({ db, ride, eligible, offerTtlSeconds, traceId, context, clock }) {
  const nowMs = clock.now();
  const expiresAtMs = nowMs + offerTtlSeconds * 1000;
  const preview = pickupPreview(ride.pickup);
  const offerIds = [];

  // Persist every deterministic offer first. In production, a genuine task
  // enqueue failure fails dispatch closed rather than leaving an endless search.
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

  await scheduleOfferExpiry({ rideId: ride.rideId, expiresAtMs, traceId, context });

  // Notify only after server expiry is guaranteed (or deliberately skipped by
  // the isolated Jest environment).
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
  isTaskAlreadyExists,
  EXPIRY_TASK_NAME,
};