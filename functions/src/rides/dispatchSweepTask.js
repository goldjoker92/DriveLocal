// @ts-check
// Continuous-search sweep. Runs every minute and does two things for rides still
// in SEARCHING:
//
//   1. runs the next dispatch wave, so a driver who came online after the ride
//      was created is still reached (this is the case the launch data shows most
//      often: supply appears and disappears while a ride is searching);
//   2. closes the search once the window has elapsed, WITHOUT depending on Cloud
//      Tasks. Offer expiry stays scheduled as before, but a Tasks outage can no
//      longer leave a ride searching forever or, worse, block dispatch entirely.
//
// Everything here is idempotent and bounded: a ride that was accepted, cancelled
// or already closed between two runs is simply skipped.

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logInfo, logWarning } = require('../logging/logger');
const { runDispatchWave } = require('./dispatchWaveTask');
const { dueWaveIndex } = require('./dispatchWavePolicy');
const { expireRideOffers } = require('./expireOffersTask');
const C = require('./constants');

const REGION = 'southamerica-east1';
const TIME_ZONE = 'America/Fortaleza';
// Horizonte volume is a few rides per hour. This cap keeps a single run cheap
// and predictable even if a backlog ever builds up.
const MAX_RIDES_PER_RUN = 25;

/**
 * @param {{db:object, nowMs:number, context:object, clock:{now:()=>number}}} args
 */
async function sweepSearchingRides({ db, nowMs, context, clock }) {
  const snap = await db
    .collection(C.RIDE_REQUESTS)
    .where('status', '==', C.RIDE_STATUS.SEARCHING)
    .limit(MAX_RIDES_PER_RUN)
    .get();

  const summary = { scanned: 0, waves: 0, closed: 0, skipped: 0, failed: 0 };

  for (const doc of snap.docs) {
    summary.scanned += 1;
    const ride = doc.data() || {};
    const rideId = doc.id;
    const searchExpiresAtMs = Number(ride.searchExpiresAtMs || 0);

    // Window elapsed: let the shared expiry routine decide. It re-reads the ride
    // inside a transaction, so an acceptance landing right now still wins.
    if (searchExpiresAtMs > 0 && searchExpiresAtMs <= nowMs) {
      try {
        const result = await expireRideOffers({ db, rideId, nowMs, context });
        if (result.outcome === 'search_closed') summary.closed += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        logWarning(context, 'ride.dispatch_sweep.close_failed', {
          operation: 'dispatch_sweep',
          rideId,
          internalMessage: error?.message || 'unknown close failure',
        });
      }
      continue;
    }

    const lastWaveAtMs = Number(ride.lastDispatchWaveAtMs || ride.createdAtMs || 0);
    if (nowMs - lastWaveAtMs < C.DISPATCH_WAVE_INTERVAL_MS) {
      summary.skipped += 1;
      continue;
    }

    // Recover the latest wave that should already have run. Cloud Tasks normally
    // handles the exact 15-second cadence; this path is intentionally coarse.
    try {
      const recoveryWaveIndex = dueWaveIndex(ride.createdAtMs, nowMs);
      const outcome = await runDispatchWave({
        db,
        rideId,
        waveIndex: recoveryWaveIndex,
        trigger: 'scheduled_sweep_fallback',
        expandIfEmpty: true,
        context,
        clock,
      });

      summary.waves += 1;
      logInfo(context, 'ride.dispatch_sweep.wave_completed', {
        operation: 'dispatch_sweep',
        rideId,
        vehicleType: ride.vehicleType,
        offersCreated: outcome.offersCreated,
        reasonCode: outcome.reasonCode,
        dispatchWaveIndex: recoveryWaveIndex,
        fallback: true,
      });
    } catch (error) {
      summary.failed += 1;
      // A failed wave must never change the ride: the next run retries it.
      logWarning(context, 'ride.dispatch_sweep.wave_failed', {
        operation: 'dispatch_sweep',
        rideId,
        internalMessage: error?.message || 'unknown wave failure',
      });
    }
  }

  logInfo(context, 'ride.dispatch_sweep.completed', {
    operation: 'dispatch_sweep',
    ...summary,
  });
  return summary;
}

const dispatchSweepTask = onSchedule(
  {
    region: REGION,
    schedule: 'every 1 minutes',
    timeZone: TIME_ZONE,
    retryCount: 0,
  },
  async () => {
    const nowMs = Date.now();
    await sweepSearchingRides({
      db: admin.firestore(),
      nowMs,
      context: { traceId: `sweep-${nowMs}` },
      clock: { now: () => nowMs },
    });
  }
);

module.exports = { dispatchSweepTask, sweepSearchingRides, MAX_RIDES_PER_RUN };
