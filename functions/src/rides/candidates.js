// @ts-check
// Server-side candidate selection. Two parts:
//   - queryCandidateDrivers(): a BOUNDED Firestore query (never an unlimited
//     collection read) constrained by serviceAreaId + vehicleType + online
//     availability, hard-capped at maxCandidates;
//   - selectEligibleDrivers(): a PURE filter that applies precise proximity and
//     the authoritative BLOCK 03 ride-eligibility evaluator.
// The mobile app never queries drivers/pending rides directly.

const { evaluateRideEligibility } = require('../drivers/eligibility');
const { haversineMeters } = require('../geo/geo');
const C = require('./constants');

// Reads a driver's last known location from the supported field shapes.
function driverLocation(d) {
  if (d.location && Number.isFinite(d.location.lat) && Number.isFinite(d.location.lng)) {
    return { lat: d.location.lat, lng: d.location.lng };
  }
  if (Number.isFinite(d.currentLat) && Number.isFinite(d.currentLng)) {
    return { lat: d.currentLat, lng: d.currentLng };
  }
  return null;
}

function locationAgeMs(d, nowMs) {
  const ts = Number(d.locationUpdatedAtMs || 0);
  return ts > 0 ? nowMs - ts : Infinity;
}

/**
 * Bounded candidate query. Uses indexable equality fields and a hard limit.
 * @param {{db:object, serviceAreaId:string, vehicleType:string, maxCandidates?:number}} args
 * @returns {Promise<Array<{id:string, data:object}>>}
 */
async function queryCandidateDrivers({ db, serviceAreaId, vehicleType, maxCandidates }) {
  const cap = Number(maxCandidates) > 0 ? Number(maxCandidates) : C.MAX_CANDIDATES;
  const snap = await db
    .collection(C.DRIVERS)
    .where('serviceAreaId', '==', serviceAreaId)
    .where('vehicleType', '==', vehicleType)
    .where('availabilityStatus', '==', 'online')
    .limit(cap)
    .get();
  const out = [];
  snap.forEach((doc) => out.push({ id: doc.id, data: doc.data() || {} }));
  return out;
}

/**
 * Pure eligibility + proximity filter. Returns eligible candidates with their
 * straight-line distance-to-pickup (proximity only — never a fare distance).
 * @param {Array<{id:string, data:object}>} candidates
 * @param {{pickup:object, searchRadiusMeters:number, clock:{now:()=>number}}} args
 * @returns {Array<{driverId:string, data:object, distanceToPickupMeters:number}>}
 */
function selectEligibleDrivers(candidates, { pickup, searchRadiusMeters, clock }) {
  const nowMs = clock.now();
  const radius = Number(searchRadiusMeters) > 0 ? Number(searchRadiusMeters) : C.DEFAULT_SEARCH_RADIUS_METERS;
  const eligible = [];

  for (const c of candidates || []) {
    const d = c.data || {};
    if (d.availabilityStatus !== 'online') continue;
    if (d.activeRideId) continue; // already on a ride
    if (locationAgeMs(d, nowMs) > C.LOCATION_MAX_AGE_MS) continue; // stale location

    const loc = driverLocation(d);
    if (!loc) continue;
    const distanceToPickupMeters = haversineMeters(loc, pickup);
    if (!(distanceToPickupMeters <= radius)) continue;

    // Authoritative BLOCK 03 evaluator: approved + not blocked + subscription ok.
    const evalResult = evaluateRideEligibility(d, clock);
    if (!evalResult.canReceiveRides) continue;

    eligible.push({ driverId: c.id, data: d, distanceToPickupMeters: Math.round(distanceToPickupMeters) });
  }

  // Nearest first (§F: prioritize the nearest eligible driver).
  eligible.sort((a, b) => a.distanceToPickupMeters - b.distanceToPickupMeters);
  return eligible;
}

module.exports = { queryCandidateDrivers, selectEligibleDrivers, driverLocation };
