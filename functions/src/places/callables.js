// @ts-check
// Authenticated, city-restricted Places callables. Search text, provider payloads,
// addresses and coordinates are never persisted or logged. Only aggregate call
// counts and selected place IDs are retained for future City Pack promotion.

const crypto = require('crypto');
const admin = require('firebase-admin');
const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { withCallableBoundary } = require('../errors/boundary');
const { logInfo, logWarning } = require('../logging/logger');
const { pointInServiceArea } = require('../geo/geo');
const { loadOperationalPolygon } = require('../rides/serviceArea');
const C = require('../rides/constants');
const { createGooglePlacesAdapter } = require('./googlePlaces');

const REGION = 'southamerica-east1';
const PLACES_PROVIDER_API_KEY = defineSecret('PLACES_PROVIDER_API_KEY');
const PROVIDER_METRICS = 'placeProviderMetrics';
const PROMOTION_CANDIDATES = 'placePromotionCandidates';

function cleanText(value, max) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, max) : '';
}

function safeServiceAreaId(value) {
  const serviceAreaId = cleanText(value, 80) || C.DEFAULT_SERVICE_AREA_ID;
  if (!/^[A-Z0-9_]+$/.test(serviceAreaId)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'invalid serviceAreaId for place search',
      safeMetadata: { field: 'serviceAreaId' },
    });
  }
  return serviceAreaId;
}

async function loadAuthorizedCityConfig(db, request, serviceAreaId) {
  const passengerId = request?.auth?.uid;
  if (!passengerId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'place autocomplete without authentication',
    });
  }

  const [passengerSnap, configSnap] = await Promise.all([
    db.collection(C.PASSENGERS).doc(passengerId).get(),
    db.collection(C.CITY_PUBLIC_CONFIG).doc(serviceAreaId).get(),
  ]);
  if (!passengerSnap.exists) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      internalMessage: 'place autocomplete actor has no passenger profile',
    });
  }
  const passenger = passengerSnap.data() || {};
  if (passenger.serviceAreaId && passenger.serviceAreaId !== serviceAreaId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      internalMessage: 'passenger requested another city place pack',
    });
  }
  if (!configSnap.exists || (configSnap.data() || {}).active !== true) {
    throw new AppError(ERROR_CODES.SERVICE_AREA_INACTIVE, {
      internalMessage: `place autocomplete service area inactive: ${serviceAreaId}`,
    });
  }
  return configSnap.data() || {};
}

function monthBucket(now = new Date()) {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function recordSearchMetrics(db, serviceAreaId, itemCount) {
  const bucket = monthBucket();
  await db.collection(PROVIDER_METRICS).doc(`${serviceAreaId}_${bucket}`).set({
    serviceAreaId,
    bucket,
    provider: 'google_places',
    autocompleteCalls: admin.firestore.FieldValue.increment(1),
    predictionsReturned: admin.firestore.FieldValue.increment(Math.max(0, Number(itemCount) || 0)),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function recordPromotionCandidate(db, serviceAreaId, placeId) {
  const candidateId = crypto.createHash('sha256')
    .update(`${serviceAreaId}:${placeId}`)
    .digest('hex');
  await db.collection(PROMOTION_CANDIDATES).doc(candidateId).set({
    serviceAreaId,
    provider: 'google_places',
    placeId,
    selectionCount: admin.firestore.FieldValue.increment(1),
    lastSelectedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function searchPlaces({ db, request, context, adapter }) {
  const data = request?.data && typeof request.data === 'object' ? request.data : {};
  const query = cleanText(data.query, 120);
  const serviceAreaId = safeServiceAreaId(data.serviceAreaId);
  const sessionToken = cleanText(data.sessionToken, 120);
  const limit = Math.max(1, Math.min(5, Math.floor(Number(data.limit) || 5)));
  if (query.length < 3) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'place autocomplete query too short',
      safeMetadata: { field: 'query' },
    });
  }

  const config = await loadAuthorizedCityConfig(db, request, serviceAreaId);
  const startedAt = Date.now();
  logInfo(context, 'places.autocomplete.started', {
    operation: 'places_autocomplete',
    serviceAreaId,
    provider: 'google_places',
    queryLength: query.length,
  });

  const items = await adapter.autocomplete({
    query,
    boundingBox: config.boundaryBoundingBox,
    sessionToken,
    limit,
  });

  try {
    await recordSearchMetrics(db, serviceAreaId, items.length);
  } catch (metricsError) {
    logWarning(context, 'places.autocomplete.metrics_failed', {
      operation: 'places_autocomplete',
      serviceAreaId,
      provider: 'google_places',
      reasonCode: metricsError?.code || 'WRITE_FAILED',
    });
  }

  logInfo(context, 'places.autocomplete.succeeded', {
    operation: 'places_autocomplete',
    serviceAreaId,
    provider: 'google_places',
    itemCount: items.length,
    durationMs: Date.now() - startedAt,
  });
  return { version: 'places-autocomplete-v1', items };
}

async function resolvePlace({ db, request, context, adapter }) {
  const data = request?.data && typeof request.data === 'object' ? request.data : {};
  const serviceAreaId = safeServiceAreaId(data.serviceAreaId);
  const placeId = cleanText(data.placeId, 180);
  const sessionToken = cleanText(data.sessionToken, 120);
  if (!placeId || !/^[A-Za-z0-9_-]+$/.test(placeId)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'invalid provider place ID',
      safeMetadata: { field: 'placeId' },
    });
  }

  const config = await loadAuthorizedCityConfig(db, request, serviceAreaId);
  const startedAt = Date.now();
  logInfo(context, 'places.details.started', {
    operation: 'places_details',
    serviceAreaId,
    provider: 'google_places',
  });

  const place = await adapter.details({ placeId, sessionToken });
  if (!place) {
    throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, {
      internalMessage: 'Places details returned no usable location',
    });
  }

  const boundary = loadOperationalPolygon(serviceAreaId, config);
  if (!pointInServiceArea({ lat: place.lat, lng: place.lng }, boundary)) {
    throw new AppError(ERROR_CODES.OUT_OF_SERVICE_AREA, {
      internalMessage: 'selected provider place outside service-area polygon',
      safeMetadata: { field: 'place' },
    });
  }

  try {
    await recordPromotionCandidate(db, serviceAreaId, placeId);
  } catch (candidateError) {
    logWarning(context, 'places.promotion_candidate.failed', {
      operation: 'places_details',
      serviceAreaId,
      provider: 'google_places',
      reasonCode: candidateError?.code || 'WRITE_FAILED',
    });
  }

  logInfo(context, 'places.details.succeeded', {
    operation: 'places_details',
    serviceAreaId,
    provider: 'google_places',
    durationMs: Date.now() - startedAt,
  });
  return {
    version: 'places-autocomplete-v1',
    status: 'ok',
    label: place.label,
    lat: place.lat,
    lng: place.lng,
  };
}

function adapterFromSecret() {
  return createGooglePlacesAdapter({ apiKey: PLACES_PROVIDER_API_KEY.value() });
}

const searchPlaceSuggestionsSecure = onCall(
  { region: REGION, secrets: [PLACES_PROVIDER_API_KEY] },
  withCallableBoundary('searchPlaceSuggestionsSecure', (request, context) =>
    searchPlaces({ db: admin.firestore(), request, context, adapter: adapterFromSecret() })
  )
);

const resolvePlaceSuggestionSecure = onCall(
  { region: REGION, secrets: [PLACES_PROVIDER_API_KEY] },
  withCallableBoundary('resolvePlaceSuggestionSecure', (request, context) =>
    resolvePlace({ db: admin.firestore(), request, context, adapter: adapterFromSecret() })
  )
);

module.exports = {
  searchPlaceSuggestionsSecure,
  resolvePlaceSuggestionSecure,
  searchPlaces,
  resolvePlace,
  loadAuthorizedCityConfig,
  recordSearchMetrics,
  recordPromotionCandidate,
  SECRET_PARAMS: { PLACES_PROVIDER_API_KEY },
};
