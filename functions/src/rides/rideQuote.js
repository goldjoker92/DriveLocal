// A short-lived, server-owned fare promise. Reading this callable never creates
// a ride or offers it to a driver; confirmation consumes the quote atomically.
const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateEnum } = require('../validation/validators');
const { logInfo, logWarning } = require('../logging/logger');
const { evaluatePassengerRideEligibility } = require('../passengers/eligibility');
const { sanitizeCoord, accountDeletionPending } = require('./createRideRequest');
const { validateServiceArea } = require('./serviceArea');
const { calculateServerRideQuote } = require('./quote');
const C = require('./constants');

const QUOTE_TTL_MS = 3 * 60 * 1000;

async function getRideQuoteSecure({ db, request, context, clock, routingAdapter }) {
  const passengerId = request?.auth?.uid;
  if (!passengerId) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  const data = assertShape(request.data, {
    required: ['vehicleType', 'pickup', 'destination'],
  });
  const vehicleType = validateEnum(data.vehicleType, C.VEHICLE_TYPES, 'vehicleType');
  const pickup = sanitizeCoord(data.pickup, 'pickup');
  const destination = sanitizeCoord(data.destination, 'destination');
  logInfo(context, 'ride.quote.started', {
    operation: 'get_ride_quote', vehicleType,
  });
  try {
    const passengerSnap = await db.collection(C.PASSENGERS).doc(passengerId).get();
    const passenger = passengerSnap.exists ? passengerSnap.data() || {} : {};
    if (accountDeletionPending(passenger)
      || !evaluatePassengerRideEligibility(passenger, clock).canRequestRide) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'passenger restricted before quote',
      });
    }
    if (passenger.activeRideId) {
      const active = await db.collection(C.RIDE_REQUESTS).doc(passenger.activeRideId).get();
      if (active.exists && C.NON_FINAL_RIDE_STATUSES.includes(active.data()?.status)) {
        throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS);
      }
    }

    const serviceAreaId = C.DEFAULT_SERVICE_AREA_ID;
    const svc = await validateServiceArea({ db, serviceAreaId, vehicleType, pickup, destination });
    const nowMs = clock.now();
    const priced = await calculateServerRideQuote({
      routingAdapter, serviceAreaId, vehicleType, pickup, destination, atMs: nowMs,
    });
    const quoteRef = db.collection(C.RIDE_QUOTES).doc();
    const quote = {
      passengerId, vehicleType, pickup, destination, serviceAreaId,
      boundaryVersion: svc.config.boundaryVersion || null,
      ...priced,
      traceId: context?.traceId || quoteRef.id,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + QUOTE_TTL_MS,
      expiresAt: admin.firestore.Timestamp.fromMillis(nowMs + QUOTE_TTL_MS),
      consumedRideId: null,
      consumedIdempotencyKey: null,
    };
    await quoteRef.set(quote);
    logInfo(context, 'ride.quote.succeeded', {
      operation: 'get_ride_quote', quoteId: quoteRef.id,
      vehicleType, pricingConfigVersion: priced.pricingConfigVersion,
    });
    return {
      quoteId: quoteRef.id,
      traceId: quote.traceId,
      vehicleType, serviceAreaId,
      estimatedFareCentavos: priced.estimatedFareCentavos,
      routeDistanceMeters: priced.routeDistanceMeters,
      routeDurationSeconds: priced.routeDurationSeconds,
      peakApplied: priced.peakApplied === true,
      peakSurchargeCentavos: priced.peakSurchargeCentavos,
      pricingConfigVersion: priced.pricingConfigVersion,
      expiresAtMs: quote.expiresAtMs,
    };
  } catch (error) {
    logWarning(context, 'ride.quote.failed', {
      operation: 'get_ride_quote', vehicleType,
      reasonCode: error?.code || 'QUOTE_UNAVAILABLE',
    });
    throw error;
  }
}

module.exports = { getRideQuoteSecure, QUOTE_TTL_MS };
