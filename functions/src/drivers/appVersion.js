// @ts-check
// Server-authoritative mobile build policy for driver work sessions.
// A driver may receive new offers only while the current availability session
// carries a recent proof from a supported native build.

const MIN_SUPPORTED_DRIVER_BUILD_NUMBER = 17;

function normalizeBuildNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000
      + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function evaluateDriverBuildNumber(value, minimumBuildNumber = MIN_SUPPORTED_DRIVER_BUILD_NUMBER) {
  const buildNumber = normalizeBuildNumber(value);
  const minimum = normalizeBuildNumber(minimumBuildNumber)
    || MIN_SUPPORTED_DRIVER_BUILD_NUMBER;
  return {
    buildNumber,
    minimumBuildNumber: minimum,
    supported: buildNumber != null && buildNumber >= minimum,
  };
}

function driverHasFreshSupportedBuild(
  driver = {},
  nowMs = Date.now(),
  maxAgeMs,
  minimumBuildNumber = MIN_SUPPORTED_DRIVER_BUILD_NUMBER
) {
  const build = evaluateDriverBuildNumber(
    driver.availabilityClientBuildNumber,
    minimumBuildNumber
  );
  if (!build.supported) return false;
  if (
    !driver.availabilitySessionId
    || driver.availabilityClientSessionId !== driver.availabilitySessionId
  ) {
    return false;
  }

  const updatedAtMs = timestampToMillis(driver.availabilityClientUpdatedAt)
    || Number(driver.availabilityClientUpdatedAtMs || 0);
  const allowedAgeMs = Number(maxAgeMs);
  if (!(updatedAtMs > 0) || !(allowedAgeMs > 0)) return false;
  const ageMs = Number(nowMs) - updatedAtMs;
  return ageMs >= 0 ? ageMs <= allowedAgeMs : true;
}

module.exports = {
  MIN_SUPPORTED_DRIVER_BUILD_NUMBER,
  normalizeBuildNumber,
  timestampToMillis,
  evaluateDriverBuildNumber,
  driverHasFreshSupportedBuild,
};
