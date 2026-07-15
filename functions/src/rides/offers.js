// @ts-check
// createTargetedOffers — writes one deterministic offer document per eligible
// driver: driverOffers/{rideId}_{driverId}. Deterministic ids make dispatch
// idempotent: re-running for the same ride can never create duplicate offers.
// Documents carry only a SAFE pickup preview (coarsened coordinates) — the exact
// pickup is delivered to the winning driver at acceptance, not before.

const admin = require('firebase-admin');
const C = require('./constants');

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
    label: pickup && pickup.label ? String(pickup.label) : 'Local de embarque',
    approxLat: coarse(pickup.lat),
    approxLng: coarse(pickup.lng),
  };
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

  // Individual deterministic writes (idempotent by id) — a retry overwrites the
  // same document rather than creating a second offer for the same driver.
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
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAtMs,
      traceId: traceId || null,
    });
    offerIds.push(id);
  }
  return { createdCount: offerIds.length, offerIds };
}

module.exports = { createTargetedOffers, offerId, pickupPreview };
