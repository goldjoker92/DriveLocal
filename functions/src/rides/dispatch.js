// @ts-check
// Single bounded dispatch wave. Deterministic, idempotent outcomes so a ride is
// never left stuck:
//   - eligible offers created -> ride stays 'searching';
//   - zero candidates        -> ride becomes 'no_driver_available';
//   - offer batch failure     -> ride becomes 'dispatch_failed' (safe reasonCode).
// No multi-wave optimization, no Cloud Tasks, no global pending-ride reads.

const admin = require('firebase-admin');
const { logInfo, logWarning } = require('../logging/logger');
const { queryCandidateDrivers, selectEligibleDrivers } = require('./candidates');
const { createTargetedOffers } = require('./offers');
const C = require('./constants');

/**
 * @param {{db:object, ride:object, offerTtlSeconds:number, searchRadiusMeters:number,
 *          maxCandidates?:number, context:object, clock:{now:()=>number}}} args
 * @returns {Promise<{status:string, reasonCode:string, offersCreated:number}>}
 */
async function dispatchRide({ db, ride, offerTtlSeconds, searchRadiusMeters, maxCandidates, context, clock }) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(ride.rideId);
  const base = {
    operation: 'dispatch',
    rideId: ride.rideId,
    serviceAreaId: ride.serviceAreaId,
    vehicleType: ride.vehicleType,
  };
  logInfo(context, 'ride.dispatch.started', base);

  const candidates = await queryCandidateDrivers({
    db,
    serviceAreaId: ride.serviceAreaId,
    vehicleType: ride.vehicleType,
    maxCandidates,
  });
  const eligible = selectEligibleDrivers(candidates, { pickup: ride.pickup, searchRadiusMeters, clock });

  if (eligible.length === 0) {
    await rideRef.set(
      { status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE, reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    logInfo(context, 'ride.dispatch.no_candidates', { ...base, normalizedStatus: C.RIDE_STATUS.NO_DRIVER_AVAILABLE, reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS });
    return { status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE, reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS, offersCreated: 0 };
  }

  try {
    const { createdCount } = await createTargetedOffers({
      db,
      ride,
      eligible,
      offerTtlSeconds,
      traceId: context && context.traceId,
      clock,
    });
    // Ride REMAINS searching while offers are live.
    logInfo(context, 'ride.dispatch.offers_created', { ...base, normalizedStatus: C.RIDE_STATUS.SEARCHING, reasonCode: C.REASON.OFFERS_CREATED, offersCreated: createdCount });
    return { status: C.RIDE_STATUS.SEARCHING, reasonCode: C.REASON.OFFERS_CREATED, offersCreated: createdCount };
  } catch (err) {
    await rideRef.set(
      { status: C.RIDE_STATUS.DISPATCH_FAILED, reasonCode: C.REASON.OFFER_BATCH_FAILED, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    logWarning(context, 'ride.dispatch.no_candidates', { ...base, normalizedStatus: C.RIDE_STATUS.DISPATCH_FAILED, reasonCode: C.REASON.OFFER_BATCH_FAILED });
    return { status: C.RIDE_STATUS.DISPATCH_FAILED, reasonCode: C.REASON.OFFER_BATCH_FAILED, offersCreated: 0 };
  }
}

module.exports = { dispatchRide };
