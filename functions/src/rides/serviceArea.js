// @ts-check
// Service-area / geofence validation. Loads the ACTIVE service-area
// configuration from Firestore (cityPublicConfig/{serviceAreaId}) and validates
// that pickup and destination are inside the configured polygon. There is no
// hardcoded rectangular geofence and no minimum-driver / operating-hours gate.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { pointInServiceArea } = require('../geo/geo');
const { validateBoundaryArtifact } = require('../geo/boundaryArtifact');
const C = require('./constants');

// Firebase deploy packages the functions/ directory only. The source IBGE file
// intentionally remains outside that directory for import/seed tooling, so a
// callable must never try to read that repository path at runtime.
//
// The seed stores the validated geometry as JSON in cityPublicConfig. Runtime
// reparses it, revalidates its checksum/shape, then caches it by version+checksum.
// This keeps the deployed function self-contained and fails closed on missing or
// tampered configuration.
const boundaryCache = new Map();

function configurationError(serviceAreaId, internalMessage, cause) {
  return new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
    internalMessage: `${internalMessage}: ${serviceAreaId}`,
    cause,
    safeMetadata: { serviceAreaId },
  });
}

function loadOperationalPolygon(serviceAreaId, cfg) {
  const cacheKey = [
    serviceAreaId,
    cfg.boundaryVersion || 'no-version',
    cfg.boundaryChecksum || 'no-checksum',
  ].join(':');

  if (boundaryCache.has(cacheKey)) return boundaryCache.get(cacheKey);

  if (cfg.boundaryFormat !== 'geojson-geometry-json-v1') {
    throw configurationError(serviceAreaId, 'unsupported boundary format');
  }
  if (typeof cfg.boundaryGeoJson !== 'string' || cfg.boundaryGeoJson.trim() === '') {
    throw configurationError(serviceAreaId, 'boundary geometry missing');
  }

  let geometry;
  try {
    geometry = JSON.parse(cfg.boundaryGeoJson);
  } catch (cause) {
    throw configurationError(serviceAreaId, 'boundary geometry is not valid JSON', cause);
  }

  const artifact = {
    properties: {
      serviceAreaId: cfg.serviceAreaId || serviceAreaId,
      municipalityCode: cfg.municipalityCode,
      boundaryVersion: cfg.boundaryVersion,
      checksum: cfg.boundaryChecksum,
      boundingBox: cfg.boundaryBoundingBox,
    },
    geometry,
  };

  try {
    validateBoundaryArtifact(artifact);
  } catch (cause) {
    throw configurationError(serviceAreaId, 'boundary geometry validation failed', cause);
  }

  if (artifact.properties.serviceAreaId !== serviceAreaId) {
    throw configurationError(serviceAreaId, 'boundary service-area identity mismatch');
  }

  boundaryCache.set(cacheKey, geometry);
  return geometry;
}

/**
 * Loads and validates the service-area config, then geofences both endpoints.
 * @param {{db:object, serviceAreaId:string, vehicleType:string, pickup:object, destination:object}} args
 * @returns {Promise<{config:object, offerTtlSeconds:number, searchRadiusMeters:number}>}
 */
async function validateServiceArea({ db, serviceAreaId, vehicleType, pickup, destination }) {
  const snap = await db.collection(C.CITY_PUBLIC_CONFIG).doc(serviceAreaId).get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.SERVICE_AREA_INACTIVE, {
      internalMessage: `service area config missing: ${serviceAreaId}`,
    });
  }
  const cfg = snap.data() || {};
  if (cfg.active !== true) {
    throw new AppError(ERROR_CODES.SERVICE_AREA_INACTIVE, {
      internalMessage: `service area inactive: ${serviceAreaId}`,
    });
  }
  // Vehicle type must be allowed in this area when the config declares a list.
  if (Array.isArray(cfg.allowedVehicleTypes) && !cfg.allowedVehicleTypes.includes(vehicleType)) {
    throw new AppError(ERROR_CODES.SERVICE_AREA_INACTIVE, {
      internalMessage: `vehicle type ${vehicleType} not allowed in ${serviceAreaId}`,
    });
  }

  // Geofence authority: the pickup AND destination must both be inside the
  // operational polygon. Coordinate presence/type/range are validated upstream
  // (createRideRequest.sanitizeCoord). Edge policy: ray-casting is deterministic
  // for fixed geometry; a point exactly on an edge resolves consistently and V1
  // accepts that result. The route POLYLINE is never the authority — only the two
  // endpoints are — so a route that briefly exits the polygon does not fail.
  const boundary = loadOperationalPolygon(serviceAreaId, cfg);
  if (!pointInServiceArea(pickup, boundary)) {
    throw new AppError(ERROR_CODES.OUT_OF_SERVICE_AREA, {
      internalMessage: 'pickup outside service-area polygon',
      safeMetadata: { field: 'pickup' },
    });
  }
  if (!pointInServiceArea(destination, boundary)) {
    throw new AppError(ERROR_CODES.OUT_OF_SERVICE_AREA, {
      internalMessage: 'destination outside service-area polygon',
      safeMetadata: { field: 'destination' },
    });
  }

  const offerTtlSeconds = Number(cfg.offerTtlSeconds) > 0 ? Number(cfg.offerTtlSeconds) : C.OFFER_TTL_SECONDS;
  const searchRadiusMeters =
    Number(cfg.searchRadiusMeters) > 0 ? Number(cfg.searchRadiusMeters) : C.DEFAULT_SEARCH_RADIUS_METERS;
  return { config: cfg, offerTtlSeconds, searchRadiusMeters };
}

module.exports = { validateServiceArea, loadOperationalPolygon };
