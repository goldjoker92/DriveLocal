// @ts-check
// createTargetedOffers — writes one deterministic offer document per eligible
// driver: driverOffers/{rideId}_{driverId}. Deterministic ids make dispatch
// idempotent: re-running for the same ride can never create duplicate offers.
// Documents carry only SAFE route previews: coarse pickup coordinates and
// neighborhood/city labels with street/number removed. Exact addresses and
// destination coordinates are delivered only to the winner after acceptance.

const admin = require('firebase-admin');
const { getFunctions } = require('firebase-admin/functions');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
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

function offerId(rideId, driverId) {
  return `${rideId}_${driverId}`;
}

const STREET_PREFIX = /^(?:r(?:ua)?\.?|av(?:enida)?\.?|travessa|tv\.?|rodovia|estrada|alameda|praça|praca|br-\d+|ce-\d+)\b/i;
const COUNTRY_OR_POSTAL = /^(?:brasil|brazil|\d{5}-?\d{3})$/i;
const CITY_STATE = /^([^,]{2,80}?)\s*-\s*([A-Za-z]{2})$/;

function safeAreaPart(value) {
  let text = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!text || COUNTRY_OR_POSTAL.test(text)) return null;
  text = text.replace(/^(?:n(?:[º°.]|umero)?\s*)?\d+[A-Za-z0-9/-]*\s*-\s*/i, '');
  if (STREET_PREFIX.test(text)) {
    const sections = text.split(/\s+-\s+/).filter(Boolean);
    if (sections.length < 2) return null;
    text = sections[sections.length - 1].trim();
  }
  if (!text || STREET_PREFIX.test(text) || /\b\d{3,}\b/.test(text) || text.includes(',')) {
    return null;
  }
  return text.slice(0, 80);
}

function publicAreaLabel(point, fallback) {
  const raw = typeof point?.label === 'string'
    ? point.label.normalize('NFKC').trim().replace(/\s+/g, ' ')
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
    label: publicAreaLabel(pickup, 'Região do embarque'),
    approxLat: coarse(pickup.lat),
    approxLng: coarse(pickup.lng),
  };
}

function destinationPreview(destination) {
  return { label: publicAreaLabel(destination, 'Região do destino') };
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
  return code === '6'
    || code === 'already-exists'
    || code === 'task-already-exists'
    || code.endsWith('/already-exists')
    || code.endsWith('/task-already-exists');
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

  try {
    const queue = getFunctions().taskQueue(EXPIRY_TASK_NAME);
    await queue.enqueue(
      { rideId, traceId: traceId || null },
      {
        scheduleTime: new Date(expiresAtMs + 1000),
        dispatchDeadlineSeconds: 60,
        // One ride can now have several overlapping 30-second offer batches.
        // Including the deadline keeps every batch independently expirable.
        id: `expire-offers-${rideId}-${Math.floor(expiresAtMs / 1000)}`,
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
      fallback: 'dispatchSweepTask',
      internalMessage: error?.message || 'unknown task enqueue error',
    });
    // Fail open: offer acceptance remains server-authoritative through
    // expiresAtMs and the scheduled sweep closes stale offers/searches. A task
    // outage must not turn a valid passenger request into dispatch_failed.
    return { scheduled: false, reasonCode: 'ENQUEUE_FAILED_FALLBACK_SWEEP' };
  }
}

/**
 * @param {{db:object, ride:object, eligible:Array<object>, offerTtlSeconds:number,
 *          traceId?:string, context?:object, clock:{now:()=>number}}} args
 * @returns {Promise<{createdCount:number, offerIds:string[]}>}
 */
async function createTargetedOffers({ db, ride, eligible, offerTtlSeconds, traceId, context, clock }) {
  const nowMs = clock.now();
  const requestedExpiresAtMs = nowMs + Math.max(1, Number(offerTtlSeconds)) * 1000;
  const searchExpiresAtMs = Number(ride.searchExpiresAtMs || 0);
  const expiresAtMs = searchExpiresAtMs > nowMs
    ? Math.min(requestedExpiresAtMs, searchExpiresAtMs)
    : requestedExpiresAtMs;
  const preview = pickupPreview(ride.pickup);
  const destination = destinationPreview(ride.destination);
  const routeDistanceMeters = safeRouteMetric(ride.routeDistanceMeters);
  const routeDurationSeconds = safeRouteMetric(ride.routeDurationSeconds);
  const candidates = Array.isArray(eligible) ? eligible : [];
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(ride.rideId);
  const offerRefs = candidates.map((cand) => db
    .collection(C.DRIVER_OFFERS)
    .doc(offerId(ride.rideId, cand.driverId)));

  // Offers and their notification outbox rows are created atomically. The
  // read-before-write transaction also guarantees that a replayed wave cannot
  // reopen a declined/expired offer or send the same push twice.
  const transactionResult = await db.runTransaction(async (tx) => {
    const liveRideSnap = await tx.get(rideRef);
    const snapshots = [];
    for (const ref of offerRefs) snapshots.push(await tx.get(ref));

    if (!liveRideSnap.exists) {
      return { created: [], skippedReason: 'RIDE_MISSING', rideStatus: null };
    }
    const liveRide = liveRideSnap.data() || {};
    if (liveRide.status !== C.RIDE_STATUS.SEARCHING) {
      return {
        created: [],
        skippedReason: 'RIDE_NOT_SEARCHING',
        rideStatus: liveRide.status || null,
      };
    }
    if (Number(liveRide.searchExpiresAtMs || 0) > 0
      && Number(liveRide.searchExpiresAtMs) <= nowMs) {
      return {
        created: [],
        skippedReason: 'SEARCH_EXPIRED',
        rideStatus: liveRide.status,
      };
    }

    const out = [];
    for (let index = 0; index < candidates.length; index += 1) {
      if (snapshots[index].exists) continue;
      const cand = candidates[index];
      const ref = offerRefs[index];
      const id = ref.id;
      tx.set(ref, {
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
        dispatchWaveIndex: Number.isInteger(ride.dispatchWaveIndex)
          ? ride.dispatchWaveIndex
          : null,
        dispatchWaveRadiusMeters: Number(ride.dispatchWaveRadiusMeters || 0) || null,
        traceId: traceId || null,
      });
      const event = buildNotificationEvent({
        rideId: ride.rideId,
        eventType: C.NOTIFICATION_EVENT.OFFER_CREATED,
        recipientUid: cand.driverId,
        recipientRole: 'driver',
        route: '/ride-request',
        offerId: id,
        dedupeSuffix: cand.driverId,
        traceId: traceId || null,
        nowMs,
        expiresAtMs,
      });
      enqueueEventTx(tx, db, event);
      out.push({ offerId: id, driverId: cand.driverId });
    }

    const currentOffered = Array.isArray(liveRide.offeredDriverIds)
      ? liveRide.offeredDriverIds
      : [];
    const offeredDriverIds = [...new Set([
      ...currentOffered,
      ...candidates.map((candidate) => candidate.driverId),
    ])].slice(0, C.MAX_TRACKED_OFFERED_DRIVERS);
    const currentAttempts = Array.isArray(liveRide.dispatchWaveIndexesAttempted)
      ? liveRide.dispatchWaveIndexesAttempted
      : [];
    const waveIndex = Number.isInteger(ride.dispatchWaveIndex)
      ? ride.dispatchWaveIndex
      : null;
    const dispatchWaveIndexesAttempted = waveIndex == null
      ? currentAttempts
      : [...new Set([...currentAttempts, waveIndex])].sort((a, b) => a - b);

    tx.set(rideRef, {
      offeredDriverIds,
      reasonCode: out.length > 0
        ? C.REASON.OFFERS_CREATED
        : (liveRide.reasonCode || C.REASON.SEARCH_CONTINUES),
      dispatchWavePlanVersion: C.DISPATCH_WAVE_PLAN_VERSION,
      dispatchWaveIndexesAttempted,
      lastDispatchWaveIndex: waveIndex == null
        ? (liveRide.lastDispatchWaveIndex ?? null)
        : Math.max(Number(liveRide.lastDispatchWaveIndex ?? -1), waveIndex),
      lastDispatchWaveRadiusMeters: Number(ride.dispatchWaveRadiusMeters || 0) || null,
      lastDispatchWaveTrigger: ride.dispatchWaveTrigger || null,
      lastDispatchWaveAtMs: nowMs,
      ...(out.length > 0 ? {
        lastDispatchErrorAtMs: null,
        lastDispatchErrorCode: null,
      } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      created: out,
      skippedReason: null,
      rideStatus: liveRide.status,
    };
  });

  if (transactionResult.created.length > 0) {
    await scheduleOfferExpiry({ rideId: ride.rideId, expiresAtMs, traceId, context });
  }

  return {
    createdCount: transactionResult.created.length,
    offerIds: transactionResult.created.map((item) => item.offerId),
    driverIds: transactionResult.created.map((item) => item.driverId),
    expiresAtMs,
    skippedReason: transactionResult.skippedReason,
    rideStatus: transactionResult.rideStatus,
  };
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
