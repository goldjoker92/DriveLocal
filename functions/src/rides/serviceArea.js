// @ts-check
// Service-area / geofence validation. Loads the ACTIVE service-area
// configuration from Firestore and validates that pickup and destination are
// inside the committed municipality polygon.

const crypto = require('crypto');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { pointInServiceArea } = require('../geo/geo');
const { validateBoundaryArtifact } = require('../geo/boundaryArtifact');
const C = require('./constants');

const boundaryCache = new Map();

function configurationError(serviceAreaId, internalMessage, cause) {
  return new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
    internalMessage: `${internalMessage}: ${serviceAreaId}`,
    cause,
    safeMetadata: { serviceAreaId },
  });
}

function loadOperationalPolygon(serviceAreaId, cfg) {
  if (cfg.boundaryFormat !== 'geojson-geometry-json-v1') {
    throw configurationError(serviceAreaId, 'unsupported boundary format');
  }
  if (typeof cfg.boundaryGeoJson !== 'string' || cfg.boundaryGeoJson.trim() === '') {
    throw configurationError(serviceAreaId, 'boundary geometry missing');
  }

  const serializedGeometry = cfg.boundaryGeoJson.trim();
  const serializedFingerprint = crypto
    .createHash('sha256')
    .update(serializedGeometry)
    .digest('hex');
  const cacheKey = [
    serviceAreaId,
    cfg.boundaryVersion || 'no-version',
    cfg.boundaryChecksum || 'no-checksum',
    serializedFingerprint,
  ].join(':');

  if (boundaryCache.has(cacheKey)) return boundaryCache.get(cacheKey);

  let geometry;
  try {
    geometry = JSON.parse(serializedGeometry);
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

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return parsed > 0 && Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Resolves the effective dispatch policy. Horizonte V1 is deliberately
 * self-healing: an old Firestore document created before the launch-policy seed
 * must not silently restore a 5 km radius, 15 second offer or 25-driver cap.
 * A future density-optimized mode can explicitly opt back into configurable
 * values after launch.
 *
 * @param {string} serviceAreaId
 * @param {object} cfg
 */
function resolveDispatchPolicy(serviceAreaId, cfg = {}) {
  const launchMode = serviceAreaId === C.DEFAULT_SERVICE_AREA_ID
    && cfg.dispatchMode !== 'density_optimized';

  if (launchMode) {
    return {
      dispatchMode: 'citywide_launch',
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      searchRadiusMeters: C.DEFAULT_SEARCH_RADIUS_METERS,
      maxCandidates: C.MAX_CANDIDATES,
      source: cfg.dispatchMode === 'citywide_launch' ? 'firestore_launch' : 'backend_launch_fallback',
    };
  }

  return {
    dispatchMode: cfg.dispatchMode || 'configured',
    offerTtlSeconds: positiveNumber(cfg.offerTtlSeconds, C.OFFER_TTL_SECONDS),
    searchRadiusMeters: positiveNumber(cfg.searchRadiusMeters, C.DEFAULT_SEARCH_RADIUS_METERS),
    maxCandidates: Math.min(
      Math.floor(positiveNumber(cfg.maxCandidates, C.MAX_CANDIDATES)),
      C.MAX_CANDIDATES
    ),
    source: 'firestore_config',
  };
}

/**
 * Loads and validates the service-area config, then geofences both endpoints.
 * @param {{db:object, serviceAreaId:string, vehicleType:string, pickup:object, destination:object}} args
 * @returns {Promise<{config:object,dispatchMode:string,policySource:string,offerTtlSeconds:number,searchRadiusMeters:number,maxCandidates:number}>}
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
  if (Array.isArray(cfg.allowedVehicleTypes) && !cfg.allowedVehicleTypes.includes(vehicleType)) {
    throw new AppError(ERROR_CODES.SERVICE_AREA_INACTIVE, {
      internalMessage: `vehicle type ${vehicleType} not allowed in ${serviceAreaId}`,
    });
  }

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

  const policy = resolveDispatchPolicy(serviceAreaId, cfg);
  return {
    config: cfg,
    dispatchMode: policy.dispatchMode,
    policySource: policy.source,
    offerTtlSeconds: policy.offerTtlSeconds,
    searchRadiusMeters: policy.searchRadiusMeters,
    maxCandidates: policy.maxCandidates,
  };
}

module.exports = { validateServiceArea, loadOperationalPolygon, resolveDispatchPolicy };
