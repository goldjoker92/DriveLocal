// @ts-check
// Pure builder for the cityPublicConfig/{serviceAreaId} document. Kept separate
// from the seed script so it is deterministic and unit-testable. It NEVER emits
// founder-counter, pricing, driver, ride or wallet fields — those are owned
// elsewhere and preserved by the seed's merge write.

/**
 * @param {object} identity canonical service-area identity
 * @param {object} artifact validated boundary GeoJSON Feature
 * @param {object} report  { checksum, bbox } from validateBoundaryArtifact
 * @param {object} [existing] current config (only allowedVehicleTypes is carried over)
 */
function buildServiceAreaConfig(identity, artifact, report, existing = {}) {
  return {
    enabled: true,
    active: true,
    serviceAreaId: identity.serviceAreaId,
    municipalityCode: identity.municipalityCode,
    cityName: identity.cityName,
    stateCode: identity.stateCode,
    countryCode: identity.countryCode,
    timezone: identity.timezone,
    currency: identity.currency,
    locale: identity.locale,
    boundaryVersion: identity.boundaryVersion,
    operationalPolygonVersion: identity.operationalPolygonVersion,
    coverageMode: identity.coverageMode,
    pricingConfigId: identity.pricingConfigId,
    founderCounterId: identity.founderCounterId,
    allowedVehicleTypes: existing.allowedVehicleTypes || ['moto', 'car'],
    // Operational polygon === municipality boundary for V1 (documented decision).
    boundary: artifact.geometry,
    boundaryChecksum: report.checksum,
    boundaryBoundingBox: report.bbox,
  };
}

module.exports = { buildServiceAreaConfig };
