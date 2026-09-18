// @ts-check
// Sub-minute progressive dispatch orchestrator. Cloud Tasks owns the precise
// 0/15/30/45/60-second cadence; dispatchSweepTask is the one-minute recovery
// path. Every operation is idempotent because offer and task ids are deterministic.

const admin = require('firebase-admin');
const { getFunctions } = require('firebase-admin/functions');
const { onTaskDispatched } = require('firebase-functions/tasks');
const { logInfo, logWarning } = require('../logging/logger');
const { validateServiceArea } = require('./serviceArea');
const { dispatchRide } = require('./dispatch');
const { expireRideOffers } = require('./expireOffersTask');
const { isTaskAlreadyExists, EXPIRY_TASK_NAME } = require('./offers');
const {
  waveAt,
  nextWaveIndex,
  remainingSearchMs,
  offerTtlSeconds,
} = require('./dispatchWavePolicy');
const C = require('./constants');

const REGION = 'southamerica-east1';
const WAVE_TASK_NAME = `locations/${REGION}/functions/dispatchRideWaveTask`;

function validRideId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

async function enqueueTask({ queue, data, options, context, eventName, metadata }) {
  try {
    await queue.enqueue(data, options);
    logInfo(context, eventName, {
      ...metadata,
      result: 'enqueued',
    });
    return { scheduled: true, reasonCode: 'ENQUEUED' };
  } catch (error) {
    if (isTaskAlreadyExists(error)) {
      logInfo(context, `${eventName}.duplicate_ignored`, {
        ...metadata,
        result: 'already_scheduled',
      });
      return { scheduled: true, reasonCode: 'TASK_ALREADY_EXISTS' };
    }
    logWarning(context, `${eventName}.failed`, {
      ...metadata,
      fallback: 'dispatchSweepTask',
      internalMessage: error?.message || 'unknown task enqueue error',
    });
    return { scheduled: false, reasonCode: 'ENQUEUE_FAILED_FALLBACK_SWEEP' };
  }
}

/**
 * Schedules all future radius waves and the hard global search deadline.
 * Wave zero is executed synchronously by createRideRequestSecure.
 */
async function scheduleRideDispatchTasks({
  rideId,
  createdAtMs,
  searchExpiresAtMs,
  traceId,
  context,
}) {
  const futureWaves = C.DISPATCH_WAVES.filter((wave) => wave.index > 0);
  if (process.env.NODE_ENV === 'test') {
    logInfo(context, 'ride.dispatch_tasks.enqueue_skipped', {
      operation: 'schedule_dispatch_tasks',
      rideId,
      plannedWaveCount: futureWaves.length,
      reasonCode: 'TEST_ENVIRONMENT',
    });
    return {
      scheduledWaveCount: 0,
      failedWaveCount: 0,
      searchExpiryScheduled: false,
      reasonCode: 'TEST_ENVIRONMENT',
    };
  }

  const waveQueue = getFunctions().taskQueue(WAVE_TASK_NAME);
  const expiryQueue = getFunctions().taskQueue(EXPIRY_TASK_NAME);
  const wavePromises = futureWaves.map((wave) => enqueueTask({
    queue: waveQueue,
    data: {
      rideId,
      waveIndex: wave.index,
      trigger: 'scheduled_cloud_task',
      traceId: traceId || null,
    },
    options: {
      scheduleTime: new Date(Number(createdAtMs) + wave.offsetMs),
      dispatchDeadlineSeconds: 60,
      id: `dispatch-wave-${rideId}-${wave.index}`,
    },
    context,
    eventName: 'ride.dispatch_wave.enqueued',
    metadata: {
      operation: 'schedule_dispatch_wave',
      rideId,
      dispatchWaveIndex: wave.index,
      dispatchWaveRadiusMeters: wave.radiusMeters,
      scheduledForMs: Number(createdAtMs) + wave.offsetMs,
    },
  }));
  const expiryPromise = enqueueTask({
    queue: expiryQueue,
    data: { rideId, traceId: traceId || null },
    options: {
      scheduleTime: new Date(Number(searchExpiresAtMs) + 1000),
      dispatchDeadlineSeconds: 60,
      id: `expire-search-${rideId}`,
    },
    context,
    eventName: 'ride.search_expiry.enqueued',
    metadata: {
      operation: 'schedule_search_expiry',
      rideId,
      searchExpiresAtMs: Number(searchExpiresAtMs),
    },
  });
  // Five independent queue writes should cost roughly one network round trip,
  // not five sequential ones on the passenger's request path.
  const [waveResults, expiry] = await Promise.all([
    Promise.all(wavePromises),
    expiryPromise,
  ]);
  const scheduledWaveCount = waveResults.filter((result) => result.scheduled).length;
  const failedWaveCount = waveResults.length - scheduledWaveCount;

  return {
    scheduledWaveCount,
    failedWaveCount,
    searchExpiryScheduled: expiry.scheduled,
    reasonCode: failedWaveCount === 0 && expiry.scheduled
      ? 'ENQUEUED'
      : 'PARTIAL_FALLBACK_SWEEP',
  };
}

async function enqueueImmediateDispatchWave({ rideId, waveIndex, traceId, context }) {
  const wave = waveAt(waveIndex);
  if (!wave) return { scheduled: false, reasonCode: 'NO_NEXT_WAVE' };
  if (process.env.NODE_ENV === 'test') {
    return { scheduled: false, reasonCode: 'TEST_ENVIRONMENT' };
  }

  return enqueueTask({
    queue: getFunctions().taskQueue(WAVE_TASK_NAME),
    data: {
      rideId,
      waveIndex: wave.index,
      trigger: 'all_live_offers_closed_early',
      traceId: traceId || null,
    },
    options: {
      dispatchDeadlineSeconds: 60,
      id: `dispatch-advance-${rideId}-${wave.index}`,
    },
    context,
    eventName: 'ride.dispatch_wave.advance_enqueued',
    metadata: {
      operation: 'advance_dispatch_wave',
      rideId,
      dispatchWaveIndex: wave.index,
      dispatchWaveRadiusMeters: wave.radiusMeters,
    },
  });
}

async function hasLiveOffer({ db, rideId, nowMs }) {
  const snap = await db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId).get();
  let live = false;
  snap.forEach((doc) => {
    const offer = doc.data() || {};
    if (offer.status === C.OFFER_STATUS.OFFERED
      && Number(offer.expiresAtMs || 0) > nowMs) live = true;
  });
  return live;
}

/**
 * Executes one radius wave. Empty rings advance immediately, but a live offer
 * keeps its full 30-second decision window. Scheduled tasks still re-query a
 * radius even if an early-advance task already visited it, allowing newly online
 * drivers to enter later in the same passenger search.
 */
async function runDispatchWave({
  db,
  rideId,
  waveIndex,
  trigger = 'scheduled_cloud_task',
  expandIfEmpty = true,
  resolvedServiceArea = null,
  context,
  clock,
}) {
  const initialWave = waveAt(waveIndex);
  if (!initialWave) {
    logWarning(context, 'ride.dispatch_wave.invalid_index', {
      operation: 'run_dispatch_wave',
      rideId,
      dispatchWaveIndex: waveIndex,
    });
    return { outcome: 'invalid_wave', status: null, offersCreated: 0 };
  }

  let currentWave = initialWave;
  let wavesAttempted = 0;
  let offersCreated = 0;
  let serviceArea = resolvedServiceArea;

  while (currentWave) {
    const nowMs = Number(clock.now());
    const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
    const rideSnap = await rideRef.get();
    if (!rideSnap.exists) {
      return { outcome: 'ride_missing', status: null, offersCreated, wavesAttempted };
    }
    const ride = rideSnap.data() || {};
    if (ride.status !== C.RIDE_STATUS.SEARCHING) {
      logInfo(context, 'ride.dispatch_wave.terminal_skipped', {
        operation: 'run_dispatch_wave',
        rideId,
        normalizedStatus: ride.status || null,
        dispatchWaveIndex: currentWave.index,
        dispatchWaveTrigger: trigger,
      });
      return {
        outcome: `ride_${ride.status || 'unknown'}`,
        status: ride.status || null,
        offersCreated,
        wavesAttempted,
      };
    }

    const remainingMs = remainingSearchMs(ride.searchExpiresAtMs, nowMs);
    if (remainingMs <= 0) {
      const expired = await expireRideOffers({ db, rideId, nowMs, context });
      return {
        outcome: expired.outcome,
        status: expired.outcome === 'search_closed'
          ? C.RIDE_STATUS.NO_DRIVER_AVAILABLE
          : C.RIDE_STATUS.SEARCHING,
        offersCreated,
        wavesAttempted,
      };
    }

    if (!serviceArea) {
      serviceArea = await validateServiceArea({
        db,
        serviceAreaId: ride.serviceAreaId || C.DEFAULT_SERVICE_AREA_ID,
        vehicleType: ride.vehicleType,
        pickup: ride.pickup,
        destination: ride.destination,
      });
    }
    const ttlSeconds = offerTtlSeconds(ride.searchExpiresAtMs, nowMs);
    logInfo(context, 'ride.dispatch_wave.started', {
      operation: 'run_dispatch_wave',
      rideId,
      dispatchWavePlanVersion: C.DISPATCH_WAVE_PLAN_VERSION,
      dispatchWaveIndex: currentWave.index,
      dispatchWaveRadiusMeters: currentWave.radiusMeters,
      dispatchWaveTrigger: trigger,
      offerTtlSeconds: ttlSeconds,
      remainingSearchMs: remainingMs,
    });

    const result = await dispatchRide({
      db,
      ride: { ...ride, rideId },
      offerTtlSeconds: ttlSeconds,
      searchRadiusMeters: currentWave.radiusMeters,
      maxCandidates: serviceArea.maxCandidates,
      driverBuildPolicy: serviceArea.driverBuildPolicy,
      dispatchWaveIndex: currentWave.index,
      dispatchWaveTrigger: trigger,
      context,
      clock,
    });
    wavesAttempted += 1;
    offersCreated += Number(result.offersCreated || 0);

    logInfo(context, 'ride.dispatch_wave.completed', {
      operation: 'run_dispatch_wave',
      rideId,
      dispatchWavePlanVersion: C.DISPATCH_WAVE_PLAN_VERSION,
      dispatchWaveIndex: currentWave.index,
      dispatchWaveRadiusMeters: currentWave.radiusMeters,
      dispatchWaveTrigger: trigger,
      offersCreated: Number(result.offersCreated || 0),
      reasonCode: result.reasonCode,
      normalizedStatus: result.status,
    });

    if (result.status !== C.RIDE_STATUS.SEARCHING || result.offersCreated > 0) {
      return {
        outcome: result.status,
        status: result.status,
        reasonCode: result.reasonCode,
        offersCreated,
        wavesAttempted,
        lastWaveIndex: currentWave.index,
      };
    }
    if (!expandIfEmpty || await hasLiveOffer({ db, rideId, nowMs })) {
      return {
        outcome: C.RIDE_STATUS.SEARCHING,
        status: C.RIDE_STATUS.SEARCHING,
        reasonCode: result.reasonCode,
        offersCreated,
        wavesAttempted,
        lastWaveIndex: currentWave.index,
      };
    }

    const nextIndex = nextWaveIndex(currentWave.index);
    if (nextIndex == null) {
      return {
        outcome: 'searching_at_max_radius',
        status: C.RIDE_STATUS.SEARCHING,
        reasonCode: C.REASON.SEARCH_CONTINUES,
        offersCreated,
        wavesAttempted,
        lastWaveIndex: currentWave.index,
      };
    }
    const next = waveAt(nextIndex);
    logInfo(context, 'ride.dispatch_wave.empty_ring_advanced', {
      operation: 'run_dispatch_wave',
      rideId,
      fromWaveIndex: currentWave.index,
      toWaveIndex: next.index,
      toRadiusMeters: next.radiusMeters,
      dispatchWaveTrigger: trigger,
    });
    currentWave = next;
  }

  return {
    outcome: 'searching_at_max_radius',
    status: C.RIDE_STATUS.SEARCHING,
    offersCreated,
    wavesAttempted,
  };
}

const dispatchRideWaveTask = onTaskDispatched(
  {
    region: REGION,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 3 },
    rateLimits: { maxConcurrentDispatches: 50 },
  },
  async (request) => {
    const rideId = request?.data?.rideId;
    const waveIndex = Number(request?.data?.waveIndex);
    if (!validRideId(rideId) || !waveAt(waveIndex)) {
      logWarning({}, 'ride.dispatch_wave.invalid_payload', {
        operation: 'run_dispatch_wave',
        dispatchWaveIndex: waveIndex,
      });
      return { outcome: 'invalid_payload' };
    }
    return runDispatchWave({
      db: admin.firestore(),
      rideId,
      waveIndex,
      trigger: request?.data?.trigger || 'scheduled_cloud_task',
      context: { traceId: request?.data?.traceId || null },
      clock: { now: () => Date.now() },
    });
  }
);

module.exports = {
  dispatchRideWaveTask,
  scheduleRideDispatchTasks,
  enqueueImmediateDispatchWave,
  runDispatchWave,
  hasLiveOffer,
  validRideId,
  WAVE_TASK_NAME,
};
