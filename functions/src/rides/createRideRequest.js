// @ts-check
// createRideRequestSecure — a passenger requests a ride. The backend owns every
// authoritative field: passengerId (from auth), serviceAreaId (V1 = Horizonte),
// route distance/duration (routing provider), and fare/commission (pricing).
// Client-supplied fare/commission/distance/duration are rejected outright
// (unknown fields fail the shape check).
//
// Idempotent on the client key: a repeated identical call returns the SAME ride
// and never creates a second ride or duplicate offers. Routing failure aborts
// creation WITHOUT writing an incomplete ride.

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

// Validates a {lat,lng[,label]} coordinate and returns a sanitized copy.
function sanitizeCoord(value, field) {
  if (!value || typeof value !== 'object') {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `missing coordinate: ${field}`, safeMetadata: { field } });
  }
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `invalid coordinate: ${field}`, safeMetadata: { field } });
  }
  const out = { lat, lng };
  if (typeof value.label === 'string' && value.label.trim() !== '') out.label = value.label.trim().slice(0, 200);
  return out;
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}, routingAdapter:object}} args
 */
async function createRideRequestSecure({ db, request, context, clock, routingAdapter }) {
  const traceId = context && context.traceId;
  const passengerId = request && request.auth && request.auth.uid;
  if (!passengerId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { internalMessage: 'ride creation without authentication' });
  }

  // Only these client fields are accepted; fare/commission/distance/duration/
  // serviceAreaId are server-owned and rejected as unknown fields.
  const payload = assertShape(request && request.data, {
    required: ['vehicleType', 'pickup', 'destination', 'idempotencyKey'],
  });
  const vehicleType = validateEnum(payload.vehicleType, C.VEHICLE_TYPES, 'vehicleType');
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey);
  const pickup = sanitizeCoord(payload.pickup, 'pickup');
  const destination = sanitizeCoord(payload.destination, 'destination');
  const serviceAreaId = C.DEFAULT_SERVICE_AREA_ID; // V1 single-city, server-owned

  logInfo(context, 'ride.create.started', { operation: OPERATION_TYPE, serviceAreaId, vehicleType });

  // Idempotency FIRST so a replay short-circuits before any existing-ride check.
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
    throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, { internalMessage: `ride creation already in progress for key "${idempotencyKey}"` });
  }

  try {
    // Reject a passenger who already has a non-final ride (tracked on their doc).
    const paxRef = db.collection(C.PASSENGERS).doc(passengerId);
    const paxSnap = await paxRef.get();
    const activeRideId = paxSnap.exists ? (paxSnap.data() || {}).activeRideId : null;
    if (activeRideId) {
      const activeSnap = await db.collection(C.RIDE_REQUESTS).doc(activeRideId).get();
      const activeStatus = activeSnap.exists ? (activeSnap.data() || {}).status : null;
      if (activeStatus && C.NON_FINAL_RIDE_STATUSES.includes(activeStatus)) {
        throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS, { internalMessage: `passenger ${passengerId} already has ride ${activeRideId} (${activeStatus})` });
      }
    }

    const svc = await validateServiceArea({ db, serviceAreaId, vehicleType, pickup, destination });

    // Routing + pricing. A routing failure throws here -> no ride is written.
    const quote = await calculateServerRideQuote({ routingAdapter, serviceAreaId, vehicleType, pickup, destination });
    logInfo(context, 'ride.route.completed', { operation: OPERATION_TYPE, serviceAreaId, vehicleType });

    const rideRef = db.collection(C.RIDE_REQUESTS).doc();
    const rideId = rideRef.id;
    const nowMs = clock.now();
    const ride = {
      rideId,
      passengerId,
      serviceAreaId,
      // Boundary/operational polygon versions the geofence validated against
      // (server-owned; from the seeded service-area config). Persisted for audit.
      boundaryVersion: svc.config.boundaryVersion || null,
      operationalPolygonVersion: svc.config.operationalPolygonVersion || null,
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
      maxCandidates: svc.config.maxCandidates,
      context,
      clock,
    });

    const view = safeRideView(rideId, { ...ride, status: dispatch.status, reasonCode: dispatch.reasonCode });
    await completeOperation(db, idempotencyKey, view, clock);
    return view;
  } catch (err) {
    const appErr = AppError.from(err);
    await recordFailure(db, idempotencyKey, { retryable: appErr.retryable }, clock);
    throw appErr;
  }
}

module.exports = { createRideRequestSecure };
