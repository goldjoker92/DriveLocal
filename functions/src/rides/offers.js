// @ts-check
// createTargetedOffers — writes one deterministic offer document per eligible
// driver: driverOffers/{rideId}_{driverId}. Deterministic ids make dispatch
// idempotent: re-running for the same ride can never create duplicate offers.
// Documents carry only SAFE route previews: coarse pickup coordinates and
// neighborhood/city labels with street/number removed. Exact addresses and
// destination coordinates are delivered only to the winner after acceptance.

const admin = require('firebase-admin');
const { getFunctions } = require('firebase-admin/functions');
const { buildNotificationEvent, enqueueEvent } = require('../notifications/events');
const { logInfo, logWarning } = require('../logging/logger');
const { resolveCommercialPolicy } = require('../drivers/commercialPolicy');
const C = require('./constants');

const REGION = 'southamerica-east1';
const EXPIRY_TASK_NAME = `locations/${REGION}/functions/expireRideOffersTask`;
const SAFE_DRIVER_COMMISSION_BPS = new Set([0, 1200, 1500]);

// Coarsen a coordinate to ~110 m so a pre-acceptance offer never reveals the
// passenger's exact location.
function coarse(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

const STREET_PREFIX = /^(?:r(?:ua)?\\.?|av(?:enida)?\\.?|travessa|tv\\.?|rodovia|estrada|alameda|praça|praca|br-\\d+|ce-\\d+)\\b/i;
const COUNTRY_OR_POSTAL = /^(?:brasil|brazil|\\d{5}-?\\d{3})$/i;
const CITY_STATE = /^([^,]{2,80}?)\\s*-\\s*([A-Za-z]{2})$/;

function safeAreaPart(value) {
  let text = String(value || '').normalize('NFKC').trim().replace(/\\s+/g, ' ');
  if (!text || COUNTRY_OR_POSTAL.test(text)) return null;

  // Google formatted addresses commonly use "123 - Bairro". Drop the number.
  text = text.replace(/^(?:n(?:[º°.]|umero)?\\s*)?\\d+[A-Za-z0-9/-]*\\s*-\\s*/i, '');

  // A street segment may end with the neighborhood: "Rua X - Centro".
  // Keep only the suffix; a bare street name fails closed.
  if (STREET_PREFIX.test(text)) {
    const sections = text.split(/\\s+-\\s+/).filter(Boolean);
    if (sections.length < 2) return null;
    text = sections[sections.length - 1].trim();
  }

  if (
    !text
    || STREET_PREFIX.test(text)
    || /\\b\\d{3,}\\b/.test(text)
    || text.includes(',')
  ) {
    return null;
  }
  return text.slice(0, 80);
}

function publicAreaLabel(point, fallback) {
  const raw = typeof point?.label === 'string'
    ? point.label.normalize('NFKC').trim().replace(/\\s+/g, ' ')
    : '';
  if (!raw) return fallback;

  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const cityIndex = parts.findIndex((part) => CITY_STATE.test(part));
  if (cityIndex >= 0) {
    const match = parts[cityIndex].match(CITY_STATE);
    const cityState = `${match[1].trim()} - ${match[2].toUpperCase()}`;
    let neighborhood = null;
    for (let index = cityIndex - 1; index >= 0 && !neighborhood; index -= 1) {
      neighborhood = safeAreaPart(parts[index]);
    }
    return neighborhood ? `${neighborhood} · ${cityState}` : cityState;
  }

  return safeAreaPart(raw) || fallback;
}

function pickupPreview(pickup) {
  return {
    // A neighborhood/city decision cue is useful; street and number stay hidden.
    label: publicAreaLabel(pickup, 'Região do embarque'),
    approxLat: coarse(pickup.lat),
    approxLng: coarse(pickup.lng),
  };
}

function destinationPreview(destination) {
  // Destination coordinates never enter driverOffers before acceptance.
  return {
    label: publicAreaLabel(destination, 'Região do destino'),
  };
}

function safeRouteMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
}

// Only the closed percentage vocabulary crosses into driverOffers. The exact
// estimated commission remains on the private ride/ledger side of the boundary.
function commissionDisplayBpsForOffer(ride, driver, nowMs) {
  const commercial = resolveCommercialPolicy(driver || {}, nowMs);
  if (commercial.freePeriodActive || !(Number(ride?.estimatedCommissionCentavos) > 0)) {
    return 0;
  }

  const standardBps = Number(commercial.standardCommissionBps);
  if (SAFE_DRIVER_COMMISSION_BPS.has(standardBps) && standardBps > 0) return standardBps;
  return ride?.vehicleType === 'moto' ? 1200 : 1500;
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
  const destination = destinationPreview(ride.destination);
  const routeDistanceMeters = safeRouteMetric(ride.routeDistanceMeters);
  const routeDurationSeconds = safeRouteMetric(ride.routeDurationSeconds);
  const offerIds = [];

  // All offers of one wave are written in a SINGLE batch. Sequentially awaiting
  // one write per driver made the last driver ring seconds after the first
  // inside a short decision window, and a failure halfway through left part of
  // the wave persisted with no notification at all.
  // MAX_CANDIDATES (100) stays far below the 500-operation Firestore batch limit.
  const offerBatch = db.batch();
  for (const cand of eligible) {
    const id = offerId(ride.rideId, cand.driverId);
    offerBatch.set(db.collection(C.DRIVER_OFFERS).doc(id), {
      rideId: ride.rideId,
      driverId: cand.driverId,
      serviceAreaId: ride.serviceAreaId,
      vehicleType: ride.vehicleType,
      availabilitySessionId: cand.availabilitySessionId,
      estimatedFareCentavos: ride.estimatedFareCentavos,
      commissionDisplayBps: commissionDisplayBpsForOffer(ride, cand.data, nowMs),
      pickupPreview: preview,
      destinationPreview: destination,
      distanceToPickupMeters: cand.distanceToPickupMeters,
      routeDistanceMeters,
      routeDurationSeconds,
      status: C.OFFER_STATUS.OFFERED,
      driverRideStatus: null,
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAtMs,
      traceId: traceId || null,
    });
    offerIds.push(id);
  }
  await offerBatch.commit();

  // Notify BEFORE scheduling expiry. The previous order meant a Cloud Tasks
  // hiccup threw before a single push was sent: the offers existed in Firestore,
  // every eligible driver was reachable, and the passenger still saw a failure.
  // Notifications are batched for the same reason as the offers above.
  const eventBatch = db.batch();
  for (let index = 0; index < eligible.length; index += 1) {
    const cand = eligible[index];
    const event = buildNotificationEvent({
      rideId: ride.rideId,
      eventType: C.NOTIFICATION_EVENT.OFFER_CREATED,
      recipientUid: cand.driverId,
      recipientRole: 'driver',
      route: '/ride-request',
      offerId: offerIds[index],
      dedupeSuffix: cand.driverId,
      traceId: traceId || null,
      nowMs,
      // Lets the sender cap the FCM ttl at the real life of the offer instead of
      // the generic 10 minutes, so a phone that reconnects late is never woken
      // up for a ride that was assigned or closed long ago.
      expiresAtMs,
    });
    eventBatch.set(db.collection(C.NOTIFICATION_EVENTS).doc(event.id), event.data);
  }
  await eventBatch.commit();

  // Expiry is now a safety net, not a precondition. dispatchSweepTask closes an
  // elapsed search every minute on its own, so a Cloud Tasks outage must never
  // discard a wave whose offers are already persisted and notified.
  try {
    await scheduleOfferExpiry({ rideId: ride.rideId, expiresAtMs, traceId, context });
  } catch (error) {
    logWarning(context, 'ride.offer_expiry.enqueue_degraded', {
      operation: 'enqueue_offer_expiry',
      rideId: ride.rideId,
      offersCreated: offerIds.length,
      reasonCode: 'SWEEP_WILL_CLOSE_SEARCH',
      internalMessage: error?.message || 'unknown task enqueue error',
    });
  }

  return { createdCount: offerIds.length, offerIds };
}

module.exports = {
  createTargetedOffers,
  offerId,
  pickupPreview,
  destinationPreview,
  publicAreaLabel,
  commissionDisplayBpsForOffer,
  scheduleOfferExpiry,
  isTaskAlreadyExists,
  EXPIRY_TASK_NAME,
};