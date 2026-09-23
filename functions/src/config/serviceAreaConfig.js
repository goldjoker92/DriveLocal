// @ts-check
// Pure builder for the cityPublicConfig/{serviceAreaId} document. Kept separate
// from the seed script so it is deterministic and unit-testable. It NEVER emits
// founder-counter, pricing, driver, ride or wallet fields — those are owned
// elsewhere and preserved by the seed's merge write.

const C = require('../rides/constants');

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

    // Progressive launch policy for a medium-sized city with limited initial
    // supply. Runtime expands through 3/5/6/7/8 km without ever crossing the
    // municipality geofence validated above.
    dispatchMode: 'progressive_launch',
    searchRadiusMeters: C.DEFAULT_SEARCH_RADIUS_METERS,
    maxCandidates: C.MAX_CANDIDATES,
    offerTtlSeconds: C.OFFER_TTL_SECONDS,

    // Operational polygon === municipality boundary for V1 (documented decision).
    // Firestore rejects nested coordinate arrays, so the validated geometry is
    // stored as a serialized JSON string. The deployed callable reparses it and
    // validates the checksum/shape before using it. The committed IBGE artifact
    // remains the seed/import source of truth and is never fetched at ride time.
    boundaryFormat: 'geojson-geometry-json-v1',
    boundaryGeoJson: JSON.stringify(artifact.geometry),
    boundaryChecksum: report.checksum,
    boundaryBoundingBox: report.bbox,
  };
}

module.exports = { buildServiceAreaConfig };
