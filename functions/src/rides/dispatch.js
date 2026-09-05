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

/**
 * @param {{db:object, ride:object, offerTtlSeconds:number, searchRadiusMeters:number,
 *          maxCandidates?:number, context:object, clock:{now:()=>number}}} args
 * @returns {Promise<{status:string, reasonCode:string, offersCreated:number}>}
 */
async function dispatchRide({ db, ride, offerTtlSeconds, searchRadiusMeters, maxCandidates, context, clock }) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(ride.rideId);
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
  } = selectEligibleDriversWithDiagnostics(candidates, {
    pickup: ride.pickup,
    searchRadiusMeters,
    clock,
  });

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

  if (eligible.length === 0) {
    await rideRef.set(
      {
        status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
        reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logInfo(context, 'ride.dispatch.no_candidates', {
      ...base,
      ...diagnostics,
      normalizedStatus: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
      reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS,
    });
    return {
      status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
      reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS,
      offersCreated: 0,
    };
  }

  try {
    const { createdCount } = await createTargetedOffers({
      db,
      ride,
      eligible,
      offerTtlSeconds,
      traceId: context && context.traceId,
      context,
      clock,
    });
    logInfo(context, 'ride.dispatch.offers_created', {
      ...base,
      freshEligibleCount: diagnostics.freshEligibleCount,
      staleFallbackEligibleCount: diagnostics.staleFallbackEligibleCount,
      normalizedStatus: C.RIDE_STATUS.SEARCHING,
      reasonCode: C.REASON.OFFERS_CREATED,
      offersCreated: createdCount,
    });
    return {
      status: C.RIDE_STATUS.SEARCHING,
      reasonCode: C.REASON.OFFERS_CREATED,
      offersCreated: createdCount,
    };
  } catch (err) {
    await rideRef.set(
      {
        status: C.RIDE_STATUS.DISPATCH_FAILED,
        reasonCode: C.REASON.OFFER_BATCH_FAILED,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logWarning(context, 'ride.dispatch.offer_batch_failed', {
      ...base,
      normalizedStatus: C.RIDE_STATUS.DISPATCH_FAILED,
      reasonCode: C.REASON.OFFER_BATCH_FAILED,
      internalMessage: err?.message || 'unknown dispatch failure',
    });
    return {
      status: C.RIDE_STATUS.DISPATCH_FAILED,
      reasonCode: C.REASON.OFFER_BATCH_FAILED,
      offersCreated: 0,
    };
  }
}

module.exports = { dispatchRide };
