// @ts-check
// createRideRequestSecure — a passenger requests a ride. The backend owns every
// authoritative field: passengerId, service area, route, fare and dispatch.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateEnum, validateIdempotencyKey } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const {
  acquireOperation,
  completeOperation,
  recordFailure,
  OPERATION_STATES,
} = require('../idempotency/idempotency');
const { validateServiceArea } = require('./serviceArea');
const { calculateServerRideQuote } = require('./quote');
const { dispatchRide } = require('./dispatch');
const { safeRideView } = require('./safeViews');
const C = require('./constants');

const OPERATION_TYPE = 'create_ride_request';

function sanitizeCoord(value, field) {
  if (!value || typeof value !== 'object') {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `missing coordinate: ${field}`,
      safeMetadata: { field },
    });
  }
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `invalid coordinate: ${field}`,
      safeMetadata: { field },
    });
  }
  const out = { lat, lng };
  if (typeof value.label === 'string' && value.label.trim() !== '') {
    out.label = value.label.trim().slice(0, 200);
  }
  return out;
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}, routingAdapter:object}} args
 */
async function createRideRequestSecure({ db, request, context, clock, routingAdapter }) {
  const traceId = context && context.traceId;
  const passengerId = request && request.auth && request.auth.uid;
  if (!passengerId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'ride creation without authentication',
    });
  }

  const payload = assertShape(request && request.data, {
    required: ['vehicleType', 'pickup', 'destination', 'idempotencyKey'],
  });
  const vehicleType = validateEnum(payload.vehicleType, C.VEHICLE_TYPES, 'vehicleType');
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey);
  const pickup = sanitizeCoord(payload.pickup, 'pickup');
  const destination = sanitizeCoord(payload.destination, 'destination');
  const serviceAreaId = C.DEFAULT_SERVICE_AREA_ID;

  logInfo(context, 'ride.create.started', {
    operation: OPERATION_TYPE,
    serviceAreaId,
    vehicleType,
  });

  const acq = await acquireOperation(
    db,
    {
      idempotencyKey,
      operationType: OPERATION_TYPE,
      actorUid: passengerId,
      traceId,
      payload: { passengerId, vehicleType, pickup, destination },
    },
    clock
  );
  if (!acq.acquired) {
    if (acq.state === OPERATION_STATES.COMPLETED) return acq.resultReference || null;
    throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
      internalMessage: `ride creation already in progress for key "${idempotencyKey}"`,
    });
  }

  try {
    const paxRef = db.collection(C.PASSENGERS).doc(passengerId);
    const paxSnap = await paxRef.get();
    const activeRideId = paxSnap.exists ? (paxSnap.data() || {}).activeRideId : null;
    if (activeRideId) {
      const activeSnap = await db.collection(C.RIDE_REQUESTS).doc(activeRideId).get();
      const activeStatus = activeSnap.exists ? (activeSnap.data() || {}).status : null;
      if (activeStatus && C.NON_FINAL_RIDE_STATUSES.includes(activeStatus)) {
        throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS, {
          internalMessage: `passenger ${passengerId} already has ride ${activeRideId} (${activeStatus})`,
        });
      }
    }

    const svc = await validateServiceArea({
      db,
      serviceAreaId,
      vehicleType,
      pickup,
      destination,
    });
    logInfo(context, 'ride.dispatch.policy_resolved', {
      operation: OPERATION_TYPE,
      serviceAreaId,
      vehicleType,
      dispatchMode: svc.dispatchMode,
      policySource: svc.policySource,
      searchRadiusMeters: svc.searchRadiusMeters,
      maxCandidates: svc.maxCandidates,
      offerTtlSeconds: svc.offerTtlSeconds,
      locationMaxAgeMs: C.LOCATION_MAX_AGE_MS,
    });

    const quote = await calculateServerRideQuote({
      routingAdapter,
      serviceAreaId,
      vehicleType,
      pickup,
      destination,
    });
    logInfo(context, 'ride.route.completed', {
      operation: OPERATION_TYPE,
      serviceAreaId,
      vehicleType,
    });

    const rideRef = db.collection(C.RIDE_REQUESTS).doc();
    const rideId = rideRef.id;
    const nowMs = clock.now();
    const ride = {
      rideId,
      passengerId,
      serviceAreaId,
      boundaryVersion: svc.config.boundaryVersion || null,
      operationalPolygonVersion: svc.config.operationalPolygonVersion || null,
      dispatchMode: svc.dispatchMode,
      vehicleType,
      pickup,
      destination,
      routeDistanceMeters: quote.routeDistanceMeters,
      routeDurationSeconds: quote.routeDurationSeconds,
      estimatedFareCentavos: quote.estimatedFareCentavos,
      estimatedCommissionCentavos: quote.estimatedCommissionCentavos,
      pricingConfigVersion: quote.pricingConfigVersion,
      status: C.RIDE_STATUS.SEARCHING,
      acceptedDriverId: null,
      acceptedAt: null,
      commissionHoldCentavos: 0,
      reasonCode: null,
      traceId: traceId || null,
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      searchExpiresAtMs: nowMs + C.SEARCH_TTL_SECONDS * 1000,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await rideRef.set(ride);
    await paxRef.set(
      { activeRideId: rideId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    logInfo(context, 'ride.quote.created', {
      operation: OPERATION_TYPE,
      rideId,
      serviceAreaId,
      vehicleType,
      amountCentavos: quote.estimatedFareCentavos,
    });

    const dispatch = await dispatchRide({
      db,
      ride,
      offerTtlSeconds: svc.offerTtlSeconds,
      searchRadiusMeters: svc.searchRadiusMeters,
      maxCandidates: svc.maxCandidates,
      context,
      clock,
    });

    const view = safeRideView(rideId, {
      ...ride,
      status: dispatch.status,
      reasonCode: dispatch.reasonCode,
    });
    await completeOperation(db, idempotencyKey, view, clock);
    return view;
  } catch (err) {
    const appErr = AppError.from(err);
    await recordFailure(db, idempotencyKey, { retryable: appErr.retryable }, clock);
    throw appErr;
  }
}

module.exports = { createRideRequestSecure };
