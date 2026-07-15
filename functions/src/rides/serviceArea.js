// @ts-check
// Service-area / geofence validation. Loads the ACTIVE service-area
// configuration from Firestore (cityPublicConfig/{serviceAreaId}) and validates
// that pickup and destination are inside the configured polygon. There is no
// hardcoded rectangular geofence and no minimum-driver / operating-hours gate.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { pointInServiceArea } = require('../geo/geo');
const C = require('./constants');

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

  const boundary = cfg.boundary;
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

module.exports = { validateServiceArea };
