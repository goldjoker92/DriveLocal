// @ts-check
// Server-side candidate selection. The Firestore query is bounded and restricted
// to service area + vehicle type + online status. The pure selector then applies
// account eligibility, activity, location and proximity rules while returning
// aggregate rejection diagnostics (never UIDs, coordinates or profile data).

const { evaluateRideEligibility, toMillis } = require('../drivers/eligibility');
const { haversineMeters } = require('../geo/geo');
const C = require('./constants');

// A temporarily stalled Android background task must not make an explicitly
// online driver disappear immediately. During the Horizonte launch phase, a
// valid last-known point may be used for up to one hour, provided the driver's
// online status was also refreshed within that hour. Fresh drivers remain first.
const ONLINE_STALE_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

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
  return ts > 0 ? Math.max(0, nowMs - ts) : Infinity;
}

function availabilityAgeMs(d, nowMs) {
  const ts = toMillis(d.availabilityUpdatedAtMs || d.availabilityUpdatedAt);
  return ts > 0 ? Math.max(0, nowMs - ts) : Infinity;
}

function emptyDiagnostics(radius) {
  return {
    candidateCount: 0,
    eligibleCount: 0,
    freshEligibleCount: 0,
    staleFallbackEligibleCount: 0,
    rejectedCount: 0,
    rejectedOffline: 0,
    rejectedBusy: 0,
    rejectedMissingLocation: 0,
    rejectedStaleLocation: 0,
    rejectedOutsideRadius: 0,
    rejectedNotApproved: 0,
    rejectedBlocked: 0,
    rejectedSubscriptionRequired: 0,
    rejectedUnknownEligibility: 0,
    searchRadiusMeters: radius,
    locationMaxAgeMs: C.LOCATION_MAX_AGE_MS,
    staleFallbackMaxAgeMs: ONLINE_STALE_FALLBACK_MAX_AGE_MS,
    freshestLocationAgeMs: null,
    stalestLocationAgeMs: null,
  };
}

function recordLocationAge(diagnostics, ageMs) {
  if (!Number.isFinite(ageMs)) return;
  diagnostics.freshestLocationAgeMs = diagnostics.freshestLocationAgeMs == null
    ? Math.round(ageMs)
    : Math.min(diagnostics.freshestLocationAgeMs, Math.round(ageMs));
  diagnostics.stalestLocationAgeMs = diagnostics.stalestLocationAgeMs == null
    ? Math.round(ageMs)
    : Math.max(diagnostics.stalestLocationAgeMs, Math.round(ageMs));
}

/**
 * Bounded candidate query. Uses indexable equality fields and a hard limit.
 * @param {{db:object, serviceAreaId:string, vehicleType:string, maxCandidates?:number}} args
 * @returns {Promise<Array<{id:string, data:object}>>}
 */
async function queryCandidateDrivers({ db, serviceAreaId, vehicleType, maxCandidates }) {
  const requestedCap = Number(maxCandidates);
  const cap = requestedCap > 0
    ? Math.min(Math.floor(requestedCap), C.MAX_CANDIDATES)
    : C.MAX_CANDIDATES;
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
 * Pure eligibility + proximity filter with aggregate diagnostics.
 * Fresh drivers are preferred, but an explicitly online driver with a valid
 * last-known point can enter the bounded launch fallback when Android heartbeat
 * delivery pauses temporarily.
 *
 * @param {Array<{id:string, data:object}>} candidates
 * @param {{pickup:object, searchRadiusMeters:number, clock:{now:()=>number}}} args
 * @returns {{eligible:Array<{driverId:string,data:object,distanceToPickupMeters:number,locationFreshness:string,locationAgeMs:number}>, diagnostics:object}}
 */
function selectEligibleDriversWithDiagnostics(candidates, { pickup, searchRadiusMeters, clock }) {
  const nowMs = Number(clock.now());
  const radius = Number(searchRadiusMeters) > 0 ? Number(searchRadiusMeters) : C.DEFAULT_SEARCH_RADIUS_METERS;
  const diagnostics = emptyDiagnostics(radius);
  const eligible = [];

  for (const c of candidates || []) {
    diagnostics.candidateCount += 1;
    const d = c.data || {};

    if (d.availabilityStatus !== 'online') {
      diagnostics.rejectedOffline += 1;
      continue;
    }
    if (d.activeRideId) {
      diagnostics.rejectedBusy += 1;
      continue;
    }

    const evalResult = evaluateRideEligibility(d, clock);
    if (!evalResult.canReceiveRides) {
      if (d.verificationStatus !== 'approved') diagnostics.rejectedNotApproved += 1;
      else if (d.isBlocked === true) diagnostics.rejectedBlocked += 1;
      else if (evalResult.requiresSubscription) diagnostics.rejectedSubscriptionRequired += 1;
      else diagnostics.rejectedUnknownEligibility += 1;
      continue;
    }

    const loc = driverLocation(d);
    if (!loc) {
      diagnostics.rejectedMissingLocation += 1;
      continue;
    }

    const ageMs = locationAgeMs(d, nowMs);
    recordLocationAge(diagnostics, ageMs);
    const fresh = ageMs <= C.LOCATION_MAX_AGE_MS;
    const recentOnlineStatus = availabilityAgeMs(d, nowMs) <= ONLINE_STALE_FALLBACK_MAX_AGE_MS;
    const staleFallback = !fresh
      && ageMs <= ONLINE_STALE_FALLBACK_MAX_AGE_MS
      && recentOnlineStatus;

    if (!fresh && !staleFallback) {
      diagnostics.rejectedStaleLocation += 1;
      continue;
    }

    const distanceToPickupMeters = haversineMeters(loc, pickup);
    if (!(distanceToPickupMeters <= radius)) {
      diagnostics.rejectedOutsideRadius += 1;
      continue;
    }

    if (fresh) diagnostics.freshEligibleCount += 1;
    else diagnostics.staleFallbackEligibleCount += 1;

    eligible.push({
      driverId: c.id,
      data: d,
      distanceToPickupMeters: Math.round(distanceToPickupMeters),
      locationFreshness: fresh ? 'fresh' : 'stale_online_fallback',
      locationAgeMs: Math.round(ageMs),
    });
  }

  eligible.sort((a, b) => {
    const freshnessDelta = (a.locationFreshness === 'fresh' ? 0 : 1)
      - (b.locationFreshness === 'fresh' ? 0 : 1);
    return freshnessDelta || a.distanceToPickupMeters - b.distanceToPickupMeters;
  });

  diagnostics.eligibleCount = eligible.length;
  diagnostics.rejectedCount = diagnostics.candidateCount - diagnostics.eligibleCount;
  return { eligible, diagnostics };
}

function selectEligibleDrivers(candidates, args) {
  return selectEligibleDriversWithDiagnostics(candidates, args).eligible;
}

module.exports = {
  queryCandidateDrivers,
  selectEligibleDrivers,
  selectEligibleDriversWithDiagnostics,
  driverLocation,
  locationAgeMs,
  availabilityAgeMs,
  ONLINE_STALE_FALLBACK_MAX_AGE_MS,
};
