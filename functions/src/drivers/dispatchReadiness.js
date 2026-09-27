// Pure policy with no Firebase or native imports, shared by dispatch and mobile.
// A live heartbeat cannot make an old GPS fix usable. Keep session recovery
// separate from eligibility for NEW offers; accepted rides always take priority.
const C = require('../rides/constants');
const { evaluateRideEligibility } = require('./eligibility');
const { timestampToMillis, resolveDriverBuildPolicy, driverHasFreshSupportedBuild } = require('./appVersion');

function timestampMs(driver, field) {
  const value = timestampToMillis(driver?.[field]) || Number(driver?.[`${field}Ms`] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function ageMs(driver, field, nowMs) {
  const updatedAt = timestampMs(driver, field);
  return updatedAt > 0 ? Math.max(0, nowMs - updatedAt) : Infinity;
}

function driverLocation(driver = {}) {
  const location = driver.location;
  const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (valid(location?.lat, location?.lng)) return location;
  if (valid(driver.currentLat, driver.currentLng)) {
    return { lat: driver.currentLat, lng: driver.currentLng };
  }
  return null;
}

function locationAgeMs(driver, nowMs) { return ageMs(driver, 'locationUpdatedAt', nowMs); }
function availabilityAgeMs(driver, nowMs) { return ageMs(driver, 'availabilityUpdatedAt', nowMs); }
function hasMatchingAvailabilitySession(driver = {}) {
  return typeof driver.availabilitySessionId === 'string'
    && driver.availabilitySessionId.length >= 16
    && driver.locationAvailabilitySessionId === driver.availabilitySessionId;
}
function hasFreshAvailabilitySession(driver = {}, nowMs = Date.now()) {
  return driver.availabilityStatus === 'online'
    && hasMatchingAvailabilitySession(driver)
    && availabilityAgeMs(driver, nowMs) <= C.AVAILABILITY_SESSION_MAX_AGE_MS;
}

// Read-side result only. It is never a client-writable authorization flag.
function evaluateDriverDispatchReadiness(value, { nowMs = Date.now(), driverBuildPolicy } = {}) {
  const driver = value && typeof value === 'object' ? value : {};
  const sessionAge = availabilityAgeMs(driver, nowMs);
  const gpsAge = locationAgeMs(driver, nowMs);
  const result = (reason, extra = {}) => ({
    ready: reason === 'ready', reason, sessionAgeMs: sessionAge, locationAgeMs: gpsAge,
    ...extra,
  });
  if (driver.activeRideId) return result('active_ride');
  if (driver.availabilityStatus !== 'online') return result('offline');
  if (!hasMatchingAvailabilitySession(driver)) return result('session_mismatch');
  if (sessionAge > C.AVAILABILITY_SESSION_MAX_AGE_MS) return result('session_stale');

  const buildPolicy = resolveDriverBuildPolicy(driverBuildPolicy);
  if (buildPolicy.enforced && !driverHasFreshSupportedBuild(
    driver, nowMs, C.AVAILABILITY_SESSION_MAX_AGE_MS, buildPolicy.minimumBuildNumber
  )) return result('app_update_required');

  const eligibility = evaluateRideEligibility(driver, { now: () => nowMs });
  if (driver.verificationStatus !== 'approved') return result('not_approved');
  if (driver.isBlocked === true) return result('blocked');
  if (eligibility.riskRestricted) return result('risk_restricted');
  if (!eligibility.pixKeyValid) return result('pix_invalid');
  if (!eligibility.canReceiveRides) return result('not_eligible');
  if (!eligibility.commissionFree
    && !(Number(driver.walletAvailableCentavos || 0) > C.MIN_WALLET_BALANCE_CENTAVOS)) {
    return result('wallet_low');
  }
  if (!driverLocation(driver)) return result('location_missing');
  if (gpsAge > C.LOCATION_DISPATCH_MAX_AGE_MS) return result('location_stale');
  return result('ready', {
    delayed: Math.max(sessionAge, gpsAge) > C.DISPATCH_VISIBILITY_WARNING_MS,
    locationFreshness: gpsAge <= C.LOCATION_MAX_AGE_MS ? 'fresh' : 'stale_online_fallback',
  });
}

module.exports = {
  timestampMs, driverLocation, locationAgeMs, availabilityAgeMs,
  hasMatchingAvailabilitySession, hasFreshAvailabilitySession, evaluateDriverDispatchReadiness,
};
