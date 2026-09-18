// @ts-check
// Single bounded dispatch wave. Deterministic, idempotent outcomes so a ride is
// never left stuck. Aggregate diagnostics explain why queried online drivers were
// rejected without logging UIDs, coordinates, names or profile data.

const admin = require('firebase-admin');
const { logInfo, logWarning } = require('../logging/logger');
const { queryCandidateDrivers, selectEligibleDriversWithDiagnostics } = require('./candidates');
const { createTargetedOffers } = require('./offers');
const C = require('./constants');

/**
 * Closes work sessions abandoned long ago while the driver document still said
 * "online" (app killed, swiped away, or stopped by battery optimization).
 * Without this the driver keeps seeing "disponível" in his app while dispatch
 * skips him for hours, and the admin counters overstate live supply.
 *
 * A driver who is simply late publishing is NEVER closed here: he stays online,
 * his app republishes a point and he becomes dispatchable again on his own.
 *
 * Never called for a driver with an active ride: the selector rejects those
 * earlier, so an abandoned id can only belong to an idle driver. Best effort by
 * design — a failure here must never change the dispatch outcome.
 *
 * @param {{db:object, driverIds:Array<string>, context:object, base:object}} args
 * @returns {Promise<number>} number of sessions closed
 */
async function closeAbandonedWorkSessions({ db, driverIds, context, base }) {
  if (!Array.isArray(driverIds) || driverIds.length === 0) return 0;

  // Same field set as stopping a work session in drivers/availability.js, so a
  // reconciled driver is indistinguishable from one who tapped "indisponível".
  const update = {
    availabilityStatus: 'offline',
    availabilitySessionId: null,
    availabilitySessionEndedAt: admin.firestore.FieldValue.serverTimestamp(),
    availabilityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    locationAvailabilitySessionId: null,
    availabilityClosedReason: 'work_session_lease_expired',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const batch = db.batch();
    driverIds.forEach((driverId) => {
      batch.set(db.collection(C.DRIVERS).doc(driverId), update, { merge: true });
    });
    await batch.commit();
    logInfo(context, 'ride.dispatch.abandoned_work_sessions_closed', {
      ...base,
      closedCount: driverIds.length,
      workSessionAbandonedMaxAgeMs: C.WORK_SESSION_ABANDONED_MAX_AGE_MS,
    });
    return driverIds.length;
  } catch (err) {
    logWarning(context, 'ride.dispatch.abandoned_work_sessions_close_failed', {
      ...base,
      attemptedCount: driverIds.length,
      internalMessage: err?.message || 'unknown reconciliation failure',
    });
    return 0;
  }
}

async function closeUnsupportedAppBuildSessions({ db, driverIds, context, base }) {
  if (!Array.isArray(driverIds) || driverIds.length === 0) return 0;

  const update = {
    availabilityStatus: 'offline',
    availabilitySessionId: null,
    availabilitySessionEndedAt: admin.firestore.FieldValue.serverTimestamp(),
    availabilityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    locationAvailabilitySessionId: null,
    availabilityClientSessionId: null,
    availabilityClosedReason: 'mandatory_update_required',
    availabilityRequiredBuildNumber:
      Number(base.minimumDriverBuildNumber) > 0
        ? Number(base.minimumDriverBuildNumber)
        : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const batch = db.batch();
    driverIds.forEach((driverId) => {
      batch.set(db.collection(C.DRIVERS).doc(driverId), update, { merge: true });
    });
    await batch.commit();
    logWarning(context, 'ride.dispatch.unsupported_app_sessions_closed', {
      ...base,
      closedCount: driverIds.length,
      result: 'mandatory_update_required',
    });
    return driverIds.length;
  } catch (err) {
    logWarning(context, 'ride.dispatch.unsupported_app_sessions_close_failed', {
      ...base,
      attemptedCount: driverIds.length,
      internalMessage: err?.message || 'unknown reconciliation failure',
    });
    return 0;
  }
}

/**
 * @param {{db:object, ride:object, offerTtlSeconds:number, searchRadiusMeters:number,
 *          maxCandidates?:number, driverBuildPolicy?:object, dispatchWaveIndex?:number,
 *          dispatchWaveTrigger?:string, context:object, clock:{now:()=>number}}} args
 * @returns {Promise<{status:string, reasonCode:string, offersCreated:number}>}
 */
async function dispatchRide({
  db,
  ride,
  offerTtlSeconds,
  searchRadiusMeters,
  maxCandidates,
  driverBuildPolicy,
  dispatchWaveIndex,
  dispatchWaveTrigger,
  context,
  clock,
}) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(ride.rideId);
  const waveIndex = Number.isInteger(dispatchWaveIndex) ? dispatchWaveIndex : null;
  const waveTrigger = dispatchWaveTrigger || 'legacy_direct';
  const effectiveMaxCandidates = Number(maxCandidates) > 0
    ? Math.min(Math.floor(Number(maxCandidates)), C.MAX_CANDIDATES)
    : C.MAX_CANDIDATES;
  const base = {
    operation: 'dispatch',
    rideId: ride.rideId,
    serviceAreaId: ride.serviceAreaId,
    vehicleType: ride.vehicleType,
    searchRadiusMeters,
    maxCandidates: effectiveMaxCandidates,
    offerTtlSeconds,
    locationMaxAgeMs: C.LOCATION_MAX_AGE_MS,
    minimumDriverBuildEnforced: driverBuildPolicy?.enforced === true,
    minimumDriverBuildNumber: driverBuildPolicy?.minimumBuildNumber || null,
    dispatchWavePlanVersion: C.DISPATCH_WAVE_PLAN_VERSION,
    dispatchWaveIndex: waveIndex,
    dispatchWaveTrigger: waveTrigger,
  };
  logInfo(context, 'ride.dispatch.started', base);

  const candidates = await queryCandidateDrivers({
    db,
    serviceAreaId: ride.serviceAreaId,
    vehicleType: ride.vehicleType,
    maxCandidates: effectiveMaxCandidates,
  });
  const {
    eligible,
    diagnostics,
    abandonedWorkSessionDriverIds,
    unsupportedAppBuildDriverIds,
  } = selectEligibleDriversWithDiagnostics(candidates, {
    pickup: ride.pickup,
    searchRadiusMeters,
    clock,
    driverBuildPolicy,
  });

  // Incremental waves: a driver is offered a given ride exactly once. Re-offering
  // would re-notify him for a ride he already declined or ignored, and would cost
  // a write plus a push on every wave.
  const alreadyOffered = new Set(
    Array.isArray(ride.offeredDriverIds) ? ride.offeredDriverIds : []
  );
  const freshlyEligible = alreadyOffered.size === 0
    ? eligible
    : eligible.filter((candidate) => !alreadyOffered.has(candidate.driverId));
  diagnostics.alreadyOfferedCount = alreadyOffered.size;
  diagnostics.newlyReachableCount = freshlyEligible.length;

  logInfo(context, 'ride.dispatch.candidates_evaluated', {
    ...base,
    ...diagnostics,
  });

  // Close abandoned sessions before returning, whatever the dispatch outcome.
  // A driver who is merely late publishing keeps his session and recovers alone.
  await closeAbandonedWorkSessions({
    db,
    driverIds: abandonedWorkSessionDriverIds,
    context,
    base,
  });

  await closeUnsupportedAppBuildSessions({
    db,
    driverIds: unsupportedAppBuildDriverIds,
    context,
    base,
  });

  // No eligible driver right now is NOT a final answer. The ride stays in
  // SEARCHING for the whole search window: the passenger sees a genuine search
  // instead of an instant "no driver", and a driver who comes online seconds
  // later is reached by the next wave. Only the sweep task, at the end of the
  // window, is allowed to conclude that nobody came.
  if (freshlyEligible.length === 0) {
    const liveResult = await db.runTransaction(async (tx) => {
      const liveRideSnap = await tx.get(rideRef);
      if (!liveRideSnap.exists) return { updated: false, status: 'missing' };
      const liveRide = liveRideSnap.data() || {};
      if (liveRide.status !== C.RIDE_STATUS.SEARCHING) {
        return { updated: false, status: liveRide.status || 'unknown' };
      }
      const attempts = Array.isArray(liveRide.dispatchWaveIndexesAttempted)
        ? liveRide.dispatchWaveIndexesAttempted
        : [];
      tx.set(rideRef, {
        status: C.RIDE_STATUS.SEARCHING,
        reasonCode: C.REASON.SEARCH_CONTINUES,
        dispatchWavePlanVersion: C.DISPATCH_WAVE_PLAN_VERSION,
        dispatchWaveIndexesAttempted: waveIndex == null
          ? attempts
          : [...new Set([...attempts, waveIndex])].sort((a, b) => a - b),
        lastDispatchWaveIndex: waveIndex == null
          ? (liveRide.lastDispatchWaveIndex ?? null)
          : Math.max(Number(liveRide.lastDispatchWaveIndex ?? -1), waveIndex),
        lastDispatchWaveRadiusMeters: searchRadiusMeters,
        lastDispatchWaveTrigger: waveTrigger,
        lastDispatchWaveAtMs: clock.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { updated: true, status: C.RIDE_STATUS.SEARCHING };
    });
    logInfo(context, 'ride.dispatch.no_candidates', {
      ...base,
      ...diagnostics,
      normalizedStatus: liveResult.status,
      reasonCode: C.REASON.SEARCH_CONTINUES,
    });
    return {
      status: liveResult.status === C.RIDE_STATUS.SEARCHING
        ? C.RIDE_STATUS.SEARCHING
        : liveResult.status,
      reasonCode: C.REASON.SEARCH_CONTINUES,
      offersCreated: 0,
    };
  }

  try {
    const offerResult = await createTargetedOffers({
      db,
      ride: {
        ...ride,
        dispatchWaveIndex: waveIndex,
        dispatchWaveRadiusMeters: searchRadiusMeters,
        dispatchWaveTrigger: waveTrigger,
      },
      eligible: freshlyEligible,
      offerTtlSeconds,
      traceId: context && context.traceId,
      context,
      clock,
    });

    if (offerResult.skippedReason) {
      logInfo(context, 'ride.dispatch.wave_skipped', {
        ...base,
        reasonCode: offerResult.skippedReason,
        normalizedStatus: offerResult.rideStatus,
      });
      return {
        status: offerResult.rideStatus || C.RIDE_STATUS.SEARCHING,
        reasonCode: offerResult.skippedReason,
        offersCreated: 0,
      };
    }

    logInfo(context, 'ride.dispatch.offers_created', {
      ...base,
      freshEligibleCount: diagnostics.freshEligibleCount,
      staleFallbackEligibleCount: diagnostics.staleFallbackEligibleCount,
      normalizedStatus: C.RIDE_STATUS.SEARCHING,
      reasonCode: C.REASON.OFFERS_CREATED,
      offersCreated: offerResult.createdCount,
      duplicateOffersSkipped: Math.max(0, freshlyEligible.length - offerResult.createdCount),
      offerExpiresAtMs: offerResult.expiresAtMs,
    });
    return {
      status: C.RIDE_STATUS.SEARCHING,
      reasonCode: C.REASON.OFFERS_CREATED,
      offersCreated: offerResult.createdCount,
    };
  } catch (err) {
    // A transient wave failure must not terminate a valid passenger search. The
    // next Cloud Task (or the scheduled sweep fallback) retries from live state.
    await db.runTransaction(async (tx) => {
      const liveRideSnap = await tx.get(rideRef);
      if (!liveRideSnap.exists) return;
      const liveRide = liveRideSnap.data() || {};
      if (liveRide.status !== C.RIDE_STATUS.SEARCHING) return;
      tx.set(rideRef, {
        reasonCode: C.REASON.SEARCH_CONTINUES,
        lastDispatchErrorAtMs: clock.now(),
        lastDispatchErrorCode: C.REASON.OFFER_BATCH_FAILED,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    logWarning(context, 'ride.dispatch.offer_batch_failed', {
      ...base,
      normalizedStatus: C.RIDE_STATUS.SEARCHING,
      reasonCode: C.REASON.OFFER_BATCH_FAILED,
      fallback: 'next_wave_or_dispatchSweepTask',
      internalMessage: err?.message || 'unknown dispatch failure',
    });
    return {
      status: C.RIDE_STATUS.SEARCHING,
      reasonCode: C.REASON.OFFER_BATCH_FAILED,
      offersCreated: 0,
    };
  }
}

module.exports = { dispatchRide };
