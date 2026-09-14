// @ts-check
// Server-side candidate selection. The Firestore query is bounded and restricted
// to service area + vehicle type + online status. The pure selector then applies
// account eligibility, work-session, location and proximity rules while returning
// aggregate rejection diagnostics (never UIDs, coordinates or profile data).

const { evaluateRideEligibility, toMillis } = require('../drivers/eligibility');
const { driverHasFreshSupportedBuild } = require('../drivers/appVersion');
const { haversineMeters } = require('../geo/geo');
const C = require('./constants');

// Kept as a compatibility export for analytics/tests. The fallback is now bounded
// by the same short work-session lease instead of the previous one-hour window.
const ONLINE_STALE_FALLBACK_MAX_AGE_MS = C.AVAILABILITY_SESSION_MAX_AGE_MS;

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
  // Server timestamps are authoritative. Epoch-ms remains a compatibility
  // fallback for legacy records and deterministic in-memory test fixtures.
  const ts = toMillis(d.locationUpdatedAt)
    || Number(d.locationUpdatedAtMs || 0);
  return ts > 0 ? Math.max(0, nowMs - ts) : Infinity;
}

function availabilityAgeMs(d, nowMs) {
  // Never let a misconfigured phone clock extend a work session indefinitely.
  const ts = toMillis(d.availabilityUpdatedAt)
    || Number(d.availabilityUpdatedAtMs || 0);
  return ts > 0 ? Math.max(0, nowMs - ts) : Infinity;
}

function hasMatchingAvailabilitySession(d = {}) {
  return typeof d.availabilitySessionId === 'string'
    && d.availabilitySessionId.length >= 16
    && d.locationAvailabilitySessionId === d.availabilitySessionId;
}

function hasFreshAvailabilitySession(d = {}, nowMs = Date.now()) {
  return d.availabilityStatus === 'online'
    && hasMatchingAvailabilitySession(d)
    && availabilityAgeMs(d, nowMs) <= C.AVAILABILITY_SESSION_MAX_AGE_MS;
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
    rejectedMissingWorkSession: 0,
    rejectedStaleWorkSession: 0,
    rejectedUnsupportedAppBuild: 0,
    // Subset of rejectedStaleWorkSession with no sign of life for far longer:
    // the only sessions the caller is allowed to close.
    abandonedWorkSessionCount: 0,
    rejectedMissingLocation: 0,
    rejectedStaleLocation: 0,
    rejectedOutsideRadius: 0,
    rejectedNotApproved: 0,
    rejectedBlocked: 0,
    rejectedSubscriptionRequired: 0,
    rejectedUnknownEligibility: 0,
    searchRadiusMeters: radius,
    locationMaxAgeMs: C.LOCATION_MAX_AGE_MS,
    availabilitySessionMaxAgeMs: C.AVAILABILITY_SESSION_MAX_AGE_MS,
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
 * Pure eligibility + work-session + proximity filter with aggregate diagnostics.
 * A legacy online flag without a matching session-bound GPS point is deliberately
 * treated as unavailable, preventing ghost drivers and stale positions.
 *
 * @param {Array<{id:string, data:object}>} candidates
 * @param {{pickup:object, searchRadiusMeters:number, clock:{now:()=>number}}} args
 * @returns {{eligible:Array<{driverId:string,data:object,distanceToPickupMeters:number,locationFreshness:string,locationAgeMs:number,availabilitySessionId:string}>, diagnostics:object, abandonedWorkSessionDriverIds:Array<string>}}
 */
function selectEligibleDriversWithDiagnostics(candidates, { pickup, searchRadiusMeters, clock }) {
  const nowMs = Number(clock.now());
  const radius = Number(searchRadiusMeters) > 0 ? Number(searchRadiusMeters) : C.DEFAULT_SEARCH_RADIUS_METERS;
  const diagnostics = emptyDiagnostics(radius);
  const eligible = [];
  // Abandoned work sessions: still flagged online, with no published point for
  // far longer than the lease, so the app is gone (killed, swiped, battery
  // optimization). The caller closes only those, so the driver's app stops
  // claiming "disponível" while dispatch ignores him. A merely expired lease is
  // deliberately left open: the running app republishes a point and the driver
  // becomes dispatchable again by himself. Collected here, never written here:
  // this selector stays pure.
  const abandonedWorkSessionDriverIds = [];
  const unsupportedAppBuildDriverIds = [];

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
    if (!hasMatchingAvailabilitySession(d)) {
      diagnostics.rejectedMissingWorkSession += 1;
      continue;
    }
    const workSessionAgeMs = availabilityAgeMs(d, nowMs);
    if (workSessionAgeMs > C.AVAILABILITY_SESSION_MAX_AGE_MS) {
      diagnostics.rejectedStaleWorkSession += 1;
      if (workSessionAgeMs > C.WORK_SESSION_ABANDONED_MAX_AGE_MS) {
        // Reached only after the offline and activeRideId checks above, so
        // closing this session can never interrupt an ongoing ride.
        diagnostics.abandonedWorkSessionCount += 1;
        abandonedWorkSessionDriverIds.push(c.id);
      }
      continue;
    }

    if (!driverHasFreshSupportedBuild(
      d,
      nowMs,
      C.AVAILABILITY_SESSION_MAX_AGE_MS
    )) {
      diagnostics.rejectedUnsupportedAppBuild += 1;
      unsupportedAppBuildDriverIds.push(c.id);
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
    const staleFallback = !fresh && ageMs <= ONLINE_STALE_FALLBACK_MAX_AGE_MS;

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
      availabilitySessionId: d.availabilitySessionId,
    });
  }

  eligible.sort((a, b) => {
    const freshnessDelta = (a.locationFreshness === 'fresh' ? 0 : 1)
      - (b.locationFreshness === 'fresh' ? 0 : 1);
    return freshnessDelta || a.distanceToPickupMeters - b.distanceToPickupMeters;
  });

  diagnostics.eligibleCount = eligible.length;
  diagnostics.rejectedCount = diagnostics.candidateCount - diagnostics.eligibleCount;
  return {
    eligible,
    diagnostics,
    abandonedWorkSessionDriverIds,
    unsupportedAppBuildDriverIds,
  };
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
  hasMatchingAvailabilitySession,
  hasFreshAvailabilitySession,
  ONLINE_STALE_FALLBACK_MAX_AGE_MS,
};
