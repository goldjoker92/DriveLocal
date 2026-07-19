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
  const { eligible, diagnostics } = selectEligibleDriversWithDiagnostics(candidates, {
    pickup: ride.pickup,
    searchRadiusMeters,
    clock,
  });

  logInfo(context, 'ride.dispatch.candidates_evaluated', {
    ...base,
    ...diagnostics,
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
