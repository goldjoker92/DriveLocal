// @ts-check
// createRideRequestSecure — a passenger requests a ride. The backend owns every
// authoritative field: passengerId, service area, route, fare and dispatch.
// Passenger risk restrictions are evaluated server-side before route/dispatch
// costs are incurred; they never interrupt an already-active ride.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateEnum, validateIdentifier, validateIdempotencyKey } = require('../validation/validators');
const { logInfo, logWarning } = require('../logging/logger');
const {
  acquireOperation,
  completeOperation,
  recordFailure,
  OPERATION_STATES,
} = require('../idempotency/idempotency');
const { evaluatePassengerRideEligibility } = require('../passengers/eligibility');
const { validateServiceArea } = require('./serviceArea');
const { calculateServerRideQuote } = require('./quote');
const {
  runDispatchWave,
  scheduleRideDispatchTasks,
} = require('./dispatchWaveTask');
const { safeRideView } = require('./safeViews');
const C = require('./constants');

const OPERATION_TYPE = 'create_ride_request';
// The price promise lasts three minutes, but a consumed quote must outlive a
// dropped network response so its original confirmation can recover the ride.
const CONSUMED_QUOTE_TTL_MS = 24 * 60 * 60 * 1000;

async function consumedRideView({ db, savedQuote, passengerId, idempotencyKey }) {
  if (!savedQuote?.consumedRideId || savedQuote.consumedIdempotencyKey !== idempotencyKey
    || savedQuote.passengerId !== passengerId) return null;
  const existing = await db.collection(C.RIDE_REQUESTS).doc(savedQuote.consumedRideId).get();
  if (!existing.exists || existing.data()?.passengerId !== passengerId) {
    throw new AppError(ERROR_CODES.QUOTE_MISMATCH);
  }
  return safeRideView(savedQuote.consumedRideId, existing.data());
}

function checkQuote(quote, { passengerId, vehicleType, pickup, destination, serviceAreaId, nowMs }) {
  if (!quote || quote.passengerId !== passengerId || quote.serviceAreaId !== serviceAreaId
    || quote.vehicleType !== vehicleType
    || quote.pickup?.lat !== pickup.lat || quote.pickup?.lng !== pickup.lng
    || quote.destination?.lat !== destination.lat || quote.destination?.lng !== destination.lng) {
    throw new AppError(ERROR_CODES.QUOTE_MISMATCH, {
      internalMessage: 'quote ownership, route or vehicle mismatch',
    });
  }
  if (!Number.isInteger(quote.estimatedFareCentavos) || quote.estimatedFareCentavos <= 0
    || !Number.isInteger(quote.estimatedCommissionCentavos)
    || typeof quote.pricingConfigVersion !== 'string') {
    throw new AppError(ERROR_CODES.QUOTE_MISMATCH, {
      internalMessage: 'quote missing authoritative price',
    });
  }
  if (!Number.isInteger(quote.expiresAtMs) || quote.expiresAtMs <= nowMs) {
    throw new AppError(ERROR_CODES.QUOTE_EXPIRED, { internalMessage: 'quote expired' });
  }
  return quote;
}

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

function accountDeletionPending(profile) {
  return ['requested', 'processing'].includes(profile?.accountDeletionStatus);
}

async function clearPassengerActiveRideIfCurrent({ db, passengerId, rideId }) {
  const paxRef = db.collection(C.PASSENGERS).doc(passengerId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(paxRef);
    if (!snap.exists || (snap.data() || {}).activeRideId !== rideId) return false;
    tx.set(
      paxRef,
      { activeRideId: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return true;
  });
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}, routingAdapter:object}} args
 */
async function createRideRequestSecure({ db, request, context, clock, routingAdapter, requireQuote = false }) {
  const traceId = context && context.traceId;
  const passengerId = request && request.auth && request.auth.uid;
  if (!passengerId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'ride creation without authentication',
    });
  }

  const payload = assertShape(request && request.data, {
    required: ['vehicleType', 'pickup', 'destination', 'idempotencyKey'],
    optional: ['quoteId'],
  });
  const vehicleType = validateEnum(payload.vehicleType, C.VEHICLE_TYPES, 'vehicleType');
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey);
  const pickup = sanitizeCoord(payload.pickup, 'pickup');
  const destination = sanitizeCoord(payload.destination, 'destination');
  const serviceAreaId = C.DEFAULT_SERVICE_AREA_ID;
  if (requireQuote && !payload.quoteId) {
    throw new AppError(ERROR_CODES.QUOTE_MISMATCH, {
      internalMessage: 'confirmation requires a server quote',
    });
  }
  const quoteId = payload.quoteId ? validateIdentifier(payload.quoteId, 'quoteId') : null;
  const quoteRef = quoteId ? db.collection(C.RIDE_QUOTES).doc(quoteId) : null;

  logInfo(context, 'ride.create.started', {
    operation: OPERATION_TYPE,
    serviceAreaId,
    vehicleType,
    quoteId,
  });
  if (quoteRef) logInfo(context, 'ride.create_from_quote.started', {
    operation: OPERATION_TYPE, quoteId, vehicleType,
  });

  const acq = await acquireOperation(
    db,
    {
      idempotencyKey,
      operationType: OPERATION_TYPE,
      actorUid: passengerId,
      traceId,
      payload: { passengerId, vehicleType, pickup, destination, quoteId },
    },
    clock
  );
  if (!acq.acquired) {
    if (acq.state === OPERATION_STATES.COMPLETED) return acq.resultReference || null;
    if (quoteRef) {
      const saved = await quoteRef.get();
      const view = await consumedRideView({
        db, savedQuote: saved.exists ? saved.data() : null, passengerId, idempotencyKey,
      });
      if (view) {
        await completeOperation(db, idempotencyKey, view, clock);
        logInfo(context, 'ride.create_from_quote.recovered', {
          operation: OPERATION_TYPE, quoteId, rideId: view.rideId,
        });
        return view;
      }
    }
    throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
      internalMessage: 'ride creation already in progress for this idempotency operation',
    });
  }

  try {
    const paxRef = db.collection(C.PASSENGERS).doc(passengerId);
    const paxSnap = await paxRef.get();
    const passenger = paxSnap.exists ? paxSnap.data() || {} : {};

    if (accountDeletionPending(passenger)) {
      logInfo(context, 'ride.create.account_deletion_blocked', {
        operation: OPERATION_TYPE,
        result: 'blocked_new_ride',
        reasonCode: 'ACCOUNT_DELETION_PENDING',
      });
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'authenticated passenger requested account deletion',
        safeMetadata: { reason: 'ACCOUNT_DELETION_PENDING' },
      });
    }

    const eligibility = evaluatePassengerRideEligibility(passenger, clock);
    if (!eligibility.canRequestRide) {
      logInfo(context, 'ride.create.passenger_restricted', {
        operation: OPERATION_TYPE,
        result: 'blocked_new_ride',
        reasonCode: eligibility.reasonCode,
      });
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `passenger account cannot request a ride: ${eligibility.reasonCode}`,
        safeMetadata: {
          reason: eligibility.reasonCode,
          restrictionUntilMs: eligibility.restrictionUntilMs,
        },
      });
    }

    const activeRideId = passenger.activeRideId || null;
    if (activeRideId && !quoteRef) {
      const activeSnap = await db.collection(C.RIDE_REQUESTS).doc(activeRideId).get();
      const activeStatus = activeSnap.exists ? (activeSnap.data() || {}).status : null;
      if (activeStatus && C.NON_FINAL_RIDE_STATUSES.includes(activeStatus)) {
        throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS, {
          internalMessage: `passenger account already has ride ${activeRideId} (${activeStatus})`,
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
    // Compatibility stays open while the new Android build propagates through
    // Play. The operator closes it only after passengers can install the quote
    // screen; from then on old builds cannot create a ride without a quote.
    if (!quoteRef && svc.config.requirePassengerQuote === true) {
      logWarning(context, 'ride.create.legacy_quote_required', {
        operation: OPERATION_TYPE, reasonCode: 'PASSENGER_UPDATE_REQUIRED',
      });
      throw new AppError(ERROR_CODES.PASSENGER_UPDATE_REQUIRED);
    }
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

    let quote;
    if (quoteRef) {
      const quoteSnap = await quoteRef.get();
      const savedQuote = quoteSnap.exists ? quoteSnap.data() : null;
      // A network retry after the ride was written may arrive after expiry. The
      // same key returns that ride; another key cannot consume this quote again.
      if (savedQuote?.consumedRideId) {
        if (savedQuote.consumedIdempotencyKey !== idempotencyKey) {
          throw new AppError(ERROR_CODES.QUOTE_USED);
        }
        const view = await consumedRideView({ db, savedQuote, passengerId, idempotencyKey });
        if (!view) throw new AppError(ERROR_CODES.QUOTE_MISMATCH);
        await completeOperation(db, idempotencyKey, view, clock);
        return view;
      }
      quote = checkQuote(savedQuote, {
        passengerId, vehicleType, pickup, destination, serviceAreaId, nowMs: clock.now(),
      });
    } else {
      // Temporary compatibility for passenger builds shipped before the quote
      // screen. Remove this callable after the passenger minimum build advances.
      quote = await calculateServerRideQuote({
        routingAdapter, serviceAreaId, vehicleType, pickup, destination,
      });
      logInfo(context, 'ride.create.legacy_without_quote', {
        operation: OPERATION_TYPE, vehicleType,
      });
    }

    const rideRef = db.collection(C.RIDE_REQUESTS).doc();
    const rideId = rideRef.id;
    const nowMs = clock.now();
    const ride = {
      rideId,
      passengerId,
      quoteId,
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
      minimumPlatformCommissionCentavos:
        quote.minimumPlatformCommissionCentavos,
      pricingConfigVersion: quote.pricingConfigVersion,
      peakSurchargeCentavos: quote.peakSurchargeCentavos || 0,
      status: C.RIDE_STATUS.SEARCHING,
      acceptedDriverId: null,
      acceptedAt: null,
      commissionHoldCentavos: 0,
      reasonCode: null,
      traceId: quote.traceId || traceId || null,
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      searchExpiresAtMs: nowMs + C.SEARCH_TTL_SECONDS * 1000,
      dispatchWavePlanVersion: C.DISPATCH_WAVE_PLAN_VERSION,
      dispatchWaveIndexesAttempted: [],
      lastDispatchWaveIndex: null,
      lastDispatchWaveRadiusMeters: null,
      lastDispatchWaveTrigger: null,
      offeredDriverIds: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (quoteRef) {
      await db.runTransaction(async (tx) => {
        const currentQuoteSnap = await tx.get(quoteRef);
        const currentPaxSnap = await tx.get(paxRef);
        const currentQuote = currentQuoteSnap.exists ? currentQuoteSnap.data() : null;
        if (currentQuote?.consumedRideId) throw new AppError(ERROR_CODES.QUOTE_USED);
        checkQuote(currentQuote, {
          passengerId, vehicleType, pickup, destination, serviceAreaId, nowMs: clock.now(),
        });
        if (currentPaxSnap.exists && currentPaxSnap.data()?.activeRideId) {
          const prior = await tx.get(db.collection(C.RIDE_REQUESTS).doc(currentPaxSnap.data().activeRideId));
          if (prior.exists && C.NON_FINAL_RIDE_STATUSES.includes(prior.data()?.status)) {
            throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS);
          }
        }
        tx.set(rideRef, ride);
        tx.set(paxRef, {
          activeRideId: rideId, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(quoteRef, {
          consumedRideId: rideId, consumedIdempotencyKey: idempotencyKey,
          consumedAtMs: nowMs,
          expiresAt: admin.firestore.Timestamp.fromMillis(nowMs + CONSUMED_QUOTE_TTL_MS),
        }, { merge: true });
      });
    } else {
      await rideRef.set(ride);
      await paxRef.set(
        { activeRideId: rideId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    logInfo(context, 'ride.quote.created', {
      operation: OPERATION_TYPE,
      rideId,
      serviceAreaId,
      vehicleType,
      amountCentavos: quote.estimatedFareCentavos,
      minimumPlatformCommissionCentavos:
        quote.minimumPlatformCommissionCentavos,
    });

    let taskSchedule = null;
    try {
      taskSchedule = await scheduleRideDispatchTasks({
        rideId,
        createdAtMs: nowMs,
        searchExpiresAtMs: ride.searchExpiresAtMs,
        traceId: ride.traceId,
        context: { ...context, traceId: ride.traceId },
      });
    } catch (error) {
      // The minute sweep remains an independent fallback even if the task API
      // itself is temporarily unavailable during ride creation.
      logWarning(context, 'ride.dispatch_tasks.schedule_failed', {
        operation: OPERATION_TYPE,
        rideId,
        fallback: 'dispatchSweepTask',
        internalMessage: error?.message || 'unknown dispatch task scheduling failure',
      });
    }
    logInfo(context, 'ride.dispatch_tasks.schedule_completed', {
      operation: OPERATION_TYPE,
      rideId,
      scheduledWaveCount: taskSchedule?.scheduledWaveCount || 0,
      failedWaveCount: taskSchedule?.failedWaveCount || 0,
      searchExpiryScheduled: taskSchedule?.searchExpiryScheduled === true,
      reasonCode: taskSchedule?.reasonCode || 'FALLBACK_SWEEP',
    });

    const dispatch = await runDispatchWave({
      db,
      rideId,
      waveIndex: 0,
      trigger: 'initial_callable',
      expandIfEmpty: true,
      resolvedServiceArea: svc,
      context: { ...context, traceId: ride.traceId },
      clock,
    });

    if (
      dispatch.status === C.RIDE_STATUS.NO_DRIVER_AVAILABLE
      || dispatch.status === C.RIDE_STATUS.DISPATCH_FAILED
    ) {
      const cleared = await clearPassengerActiveRideIfCurrent({
        db,
        passengerId,
        rideId,
      });
      logInfo(context, 'ride.passenger_active_ride_cleared', {
        operation: OPERATION_TYPE,
        rideId,
        passengerStateCleared: cleared,
        finalStatus: dispatch.status,
      });
    }

    const view = safeRideView(rideId, {
      ...ride,
      status: dispatch.status || C.RIDE_STATUS.SEARCHING,
      reasonCode: dispatch.reasonCode,
    });
    await completeOperation(db, idempotencyKey, view, clock);
    if (quoteRef) logInfo(context, 'ride.create_from_quote.succeeded', {
      operation: OPERATION_TYPE, quoteId, rideId, traceId: ride.traceId,
    });
    return view;
  } catch (err) {
    const appErr = AppError.from(err);
    if (quoteRef && appErr.code === ERROR_CODES.QUOTE_EXPIRED) {
      logWarning(context, 'ride.quote.expired', {
        operation: OPERATION_TYPE, quoteId, reasonCode: appErr.code,
      });
    }
    if (quoteRef && [ERROR_CODES.QUOTE_EXPIRED, ERROR_CODES.QUOTE_MISMATCH, ERROR_CODES.QUOTE_USED].includes(appErr.code)) {
      logWarning(context, 'ride.create_from_quote.rejected', {
        operation: OPERATION_TYPE, quoteId, reasonCode: appErr.code,
      });
    }
    await recordFailure(db, idempotencyKey, { retryable: appErr.retryable }, clock);
    throw appErr;
  }
}

module.exports = {
  createRideRequestSecure,
  clearPassengerActiveRideIfCurrent,
  sanitizeCoord,
  accountDeletionPending,
};
