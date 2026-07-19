// @ts-check
// acceptDriverOfferSecure — a driver accepts a targeted offer. One Firestore
// transaction validates the offer/ride/driver/eligibility/wallet and atomically
// assigns the ride, marks the offer, places the commission hold and starts the
// single-current-point live-location document consumed by the passenger map.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateIdempotencyKey } = require('../validation/validators');
const { logInfo, logWarning } = require('../logging/logger');
const { writeAuditLog } = require('../audit/auditLog');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const { evaluateRideEligibility, toMillis } = require('../drivers/eligibility');
const { safeAcceptanceView } = require('./safeViews');
const C = require('./constants');

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function safeText(value, fallback, max = 80) {
  const text = value == null ? '' : String(value).trim();
  return (text || fallback).slice(0, max);
}

function publicDriverSummary(driver, vehicleType) {
  return {
    name: safeText(driver.fullName, 'Motorista DriveLocal'),
    vehicleType: safeText(driver.vehicleType || vehicleType, vehicleType || 'car', 10),
    vehicleMake: safeText(driver.vehicleMake, '', 40),
    vehicleModel: safeText(driver.vehicleModel, '', 40),
    vehicleColor: safeText(driver.vehicleColor, '', 30),
    vehiclePlate: safeText(driver.vehiclePlate || driver.plate, '—', 12).toUpperCase(),
  };
}

function resolveHold(driver, ride, nowMs) {
  const commissionFree = toMillis(driver.commissionFreeUntil) > nowMs;
  if (commissionFree) return { holdAmount: 0, commissionFree: true };
  return { holdAmount: Number(ride.estimatedCommissionCentavos || 0), commissionFree: false };
}

function trackingLocationFromDriver(driver) {
  const lat = Number(driver?.location?.lat);
  const lng = Number(driver?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}}} args
 */
async function acceptDriverOfferSecure({ db, request, context, clock }) {
  const traceId = context && context.traceId;
  const driverId = request && request.auth && request.auth.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { internalMessage: 'offer acceptance without authentication' });
  }
  const payload = assertShape(request && request.data, { required: ['offerId', 'idempotencyKey'] });
  const offerId = validateIdentifier(payload.offerId, 'offerId');
  validateIdempotencyKey(payload.idempotencyKey);

  logInfo(context, 'ride.accept.started', { operation: 'accept', offerId });

  const offerRef = db.collection(C.DRIVER_OFFERS).doc(offerId);

  const result = await db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `offer not found: ${offerId}`, safeMetadata: { field: 'offerId' } });
    }
    const offer = offerSnap.data() || {};
    if (offer.driverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, { internalMessage: `driver ${driverId} attempted offer of ${offer.driverId}` });
    }

    const rideRef = db.collection(C.RIDE_REQUESTS).doc(offer.rideId);
    const driverRef = db.collection(C.DRIVERS).doc(driverId);
    const holdRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${offer.rideId}_hold`);
    const trackingRef = db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(offer.rideId);
    const rideSnap = await tx.get(rideRef);
    const driverSnap = await tx.get(driverRef);
    const holdSnap = await tx.get(holdRef);
    if (!rideSnap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `ride not found: ${offer.rideId}` });
    }
    const ride = rideSnap.data() || {};
    const driver = driverSnap.exists ? driverSnap.data() || {} : {};
    const nowMs = clock.now();

    if (ride.status === C.RIDE_STATUS.ASSIGNED && ride.acceptedDriverId === driverId) {
      return { replay: true, ride, holdAmount: Number(ride.commissionHoldCentavos || 0) };
    }
    if (ride.status !== C.RIDE_STATUS.SEARCHING) {
      throw new AppError(ERROR_CODES.RIDE_ALREADY_ACCEPTED, { internalMessage: `ride ${offer.rideId} status is ${ride.status}` });
    }
    if (offer.status !== C.OFFER_STATUS.OFFERED) {
      throw new AppError(ERROR_CODES.OFFER_EXPIRED, { internalMessage: `offer ${offerId} status is ${offer.status}` });
    }
    if (Number(offer.expiresAtMs || 0) <= nowMs) {
      throw new AppError(ERROR_CODES.OFFER_EXPIRED, { internalMessage: `offer ${offerId} expired` });
    }

    if (driver.availabilityStatus !== 'online') {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, { internalMessage: `driver ${driverId} not online` });
    }
    if (driver.activeRideId) {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, { internalMessage: `driver ${driverId} already on ride ${driver.activeRideId}` });
    }
    const evalResult = evaluateRideEligibility(driver, clock);
    if (!evalResult.canReceiveRides) {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, { internalMessage: `driver ${driverId} not ride-eligible` });
    }

    const { holdAmount, commissionFree } = resolveHold(driver, ride, nowMs);
    if (!commissionFree) {
      const available = Number(driver.walletAvailableCentavos || 0);
      if (!(available > C.MIN_WALLET_BALANCE_CENTAVOS)) {
        throw new AppError(ERROR_CODES.WALLET_INSUFFICIENT, { internalMessage: `wallet ${available} <= min for ${driverId}` });
      }
      if (available < holdAmount) {
        throw new AppError(ERROR_CODES.WALLET_INSUFFICIENT, { internalMessage: `wallet ${available} < commission ${holdAmount} for ${driverId}` });
      }
    }

    const acceptedDriverPublic = publicDriverSummary(driver, ride.vehicleType);
    tx.set(
      rideRef,
      {
        status: C.RIDE_STATUS.ASSIGNED,
        acceptedDriverId: driverId,
        acceptedDriverPublic,
        acceptedAtMs: nowMs,
        acceptedAt: ts(),
        commissionHoldCentavos: holdAmount,
        reasonCode: null,
        updatedAt: ts(),
      },
      { merge: true }
    );
    const driverUpdate = { activeRideId: offer.rideId, updatedAt: ts() };
    if (holdAmount > 0) {
      driverUpdate.walletAvailableCentavos = Number(driver.walletAvailableCentavos || 0) - holdAmount;
      driverUpdate.walletHeldCentavos = Number(driver.walletHeldCentavos || 0) + holdAmount;
    }
    tx.set(driverRef, driverUpdate, { merge: true });
    tx.set(
      offerRef,
      {
        status: C.OFFER_STATUS.ACCEPTED,
        driverRideStatus: C.RIDE_STATUS.ASSIGNED,
        acceptedAtMs: nowMs,
        acceptedAt: ts(),
        exactPickup: { lat: ride.pickup.lat, lng: ride.pickup.lng, label: ride.pickup.label || null },
        updatedAt: ts(),
      },
      { merge: true }
    );

    const initialLocation = trackingLocationFromDriver(driver);
    if (initialLocation) {
      tx.set(
        trackingRef,
        {
          rideId: offer.rideId,
          driverId,
          vehicleType: driver.vehicleType === 'moto' ? 'moto' : 'car',
          location: initialLocation,
          accuracyMeters: Number.isFinite(Number(driver.locationAccuracyMeters)) ? Number(driver.locationAccuracyMeters) : null,
          headingDegrees: Number.isFinite(Number(driver.locationHeadingDegrees)) ? Number(driver.locationHeadingDegrees) : null,
          speedMps: Number.isFinite(Number(driver.locationSpeedMps)) ? Number(driver.locationSpeedMps) : null,
          updatedAtMs: nowMs,
          updatedAt: ts(),
        },
        { merge: true }
      );
    }

    if (holdAmount > 0 && !holdSnap.exists) {
      tx.set(holdRef, {
        driverId,
        rideId: offer.rideId,
        type: 'commission_hold',
        amountCentavos: holdAmount,
        status: 'held',
        createdAtMs: nowMs,
        createdAt: ts(),
        traceId: traceId || null,
      });
    }

    if (ride.passengerId) {
      enqueueEventTx(tx, db, buildNotificationEvent({
        rideId: offer.rideId,
        eventType: C.NOTIFICATION_EVENT.RIDE_ASSIGNED,
        recipientUid: ride.passengerId,
        recipientRole: 'passenger',
        route: '/driver-accepted',
        offerId,
        traceId: traceId || null,
        nowMs,
      }));
    }

    return {
      replay: false,
      ride: { ...ride, status: C.RIDE_STATUS.ASSIGNED, acceptedDriverId: driverId, acceptedDriverPublic },
      holdAmount,
      holdAlreadyExisted: holdSnap.exists,
    };
  });

  if (result.replay) {
    logInfo(context, 'ride.accept.won', { operation: 'accept', offerId, rideId: result.ride.rideId, normalizedStatus: 'assigned', reasonCode: 'IDEMPOTENT_REPLAY' });
    return safeAcceptanceView(result.ride.rideId, result.ride, result.holdAmount);
  }

  const rideId = result.ride.rideId;
  await writeAuditLog(
    db,
    {
      actorUid: driverId,
      actorType: 'driver',
      action: 'ride_accepted',
      targetType: 'ride',
      targetId: rideId,
      traceId,
      afterSummary: { acceptedDriverId: driverId, commissionHoldCentavos: result.holdAmount },
    },
    clock
  );
  if (result.holdAmount > 0 && !result.holdAlreadyExisted) {
    logInfo(context, 'wallet.hold.created', { operation: 'accept', rideId, offerId, amountCentavos: result.holdAmount });
  } else if (result.holdAmount > 0) {
    logInfo(context, 'wallet.hold.duplicate_ignored', { operation: 'accept', rideId, offerId });
  }
  logInfo(context, 'ride.accept.won', { operation: 'accept', offerId, rideId, normalizedStatus: 'assigned', amountCentavos: result.holdAmount });
  logInfo(context, 'ride.accept.exact_pickup_revealed', { operation: 'accept', rideId, offerId });

  try {
    const siblings = await db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId).get();
    const closes = [];
    siblings.forEach((doc) => {
      if (doc.id !== offerId && (doc.data() || {}).status === C.OFFER_STATUS.OFFERED) {
        closes.push(doc.ref.set({ status: C.OFFER_STATUS.CLOSED, updatedAt: ts() }, { merge: true }));
      }
    });
    await Promise.all(closes);
  } catch (err) {
    logWarning(context, 'ride.offer_cleanup_failed', { operation: 'accept', rideId, internalMessage: err && err.message });
  }

  return safeAcceptanceView(rideId, result.ride, result.holdAmount);
}

module.exports = { acceptDriverOfferSecure, resolveHold, publicDriverSummary, trackingLocationFromDriver };
