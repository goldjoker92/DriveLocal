// @ts-check
// acceptDriverOfferSecure — a driver accepts a targeted offer. One Firestore
// transaction validates the offer/ride/driver/eligibility/wallet and atomically
// assigns the ride, marks the offer, places the commission hold and starts the
// single-current-point live-location document consumed by the passenger map.
//
// Financial invariant: commission and commercial eligibility are frozen at
// acceptance. A later date boundary or profile update can
// never rewrite the conditions under which this ride was accepted.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateIdempotencyKey } = require('../validation/validators');
const { logInfo, logWarning } = require('../logging/logger');
const { writeAuditLog } = require('../audit/auditLog');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const { evaluateRideEligibility } = require('../drivers/eligibility');
const { buildCommercialPolicySnapshot } = require('../drivers/commercialPolicy');
const { availabilityAgeMs, locationAgeMs, driverLocation, hasMatchingAvailabilitySession } = require('./candidates');
const { safeAcceptanceView } = require('./safeViews');
const C = require('./constants');

const COMMISSION_POLICY_VERSION = 'commission-hold-v1';

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function safeText(value, fallback, max = 80) {
  const text = value == null ? '' : String(value).trim();
  return (text || fallback).slice(0, max);
}

// The active public copy is independent from the candidate review status. A new
// replacement may be pending/rejected while the last approved version remains the
// passenger-facing source of truth.
function approvedPhotoPath(driver, driverId) {
  const path = typeof driver?.driverPhotoPublicPath === 'string'
    ? driver.driverPhotoPublicPath.trim()
    : '';
  const version = typeof driver?.driverPhotoPublicVersion === 'string'
    ? driver.driverPhotoPublicVersion.trim()
    : '';
  const expectedPrefix = `publicDriverPhotos/${driverId}/`;
  if (!version) return null;
  if (path !== `${expectedPrefix}${version}.jpg`) return null;
  return path.slice(0, 240);
}

function publicDriverSummary(driver, vehicleType, driverId = '') {
  const photoStoragePath = driverId ? approvedPhotoPath(driver, driverId) : null;
  return {
    name: safeText(driver.fullName, 'Motorista DriveLocal'),
    vehicleType: safeText(driver.vehicleType || vehicleType, vehicleType || 'car', 10),
    vehicleMake: safeText(driver.vehicleMake || driver.vehicleBrand, '', 40),
    vehicleModel: safeText(driver.vehicleModel, '', 40),
    vehicleColor: safeText(driver.vehicleColor, '', 30),
    vehiclePlate: safeText(driver.vehiclePlate || driver.plate, '—', 12).toUpperCase(),
    photoStoragePath,
    photoVerified: Boolean(photoStoragePath),
  };
}

// Preserve the historical return shape because this helper is directly tested.
// The richer commercial snapshot is built separately inside the transaction.
function resolveHold(driver, ride, nowMs) {
  const commercial = buildCommercialPolicySnapshot(driver, nowMs);
  const commissionFree = commercial.commissionFreeAtAcceptance;
  return {
    holdAmount: commissionFree ? 0 : Number(ride.estimatedCommissionCentavos || 0),
    commissionFree,
  };
}

function buildCommissionPolicySnapshot(ride, holdAmount, commissionFree, nowMs) {
  return {
    policyVersion: COMMISSION_POLICY_VERSION,
    pricingConfigVersion: ride.pricingConfigVersion || null,
    estimatedCommissionCentavos: Number(ride.estimatedCommissionCentavos || 0),
    holdAmountCentavos: holdAmount,
    commissionFreeAtAcceptance: commissionFree,
    acceptedAtMs: nowMs,
  };
}

function trackingLocationFromDriver(driver) {
  const lat = Number(driver?.location?.lat);
  const lng = Number(driver?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

async function acceptDriverOfferSecure({ db, request, context, clock }) {
  const traceId = context && context.traceId;
  const driverId = request && request.auth && request.auth.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'offer acceptance without authentication',
    });
  }
  const payload = assertShape(request && request.data, { required: ['offerId', 'idempotencyKey'] });
  const offerId = validateIdentifier(payload.offerId, 'offerId');
  validateIdempotencyKey(payload.idempotencyKey);

  logInfo(context, 'ride.accept.started', { operation: 'accept', offerId });
  const offerRef = db.collection(C.DRIVER_OFFERS).doc(offerId);

  const result = await db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `offer not found: ${offerId}`,
        safeMetadata: { field: 'offerId' },
      });
    }
    const offer = offerSnap.data() || {};
    if (offer.driverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, {
        internalMessage: `driver ${driverId} attempted offer of ${offer.driverId}`,
      });
    }

    const rideRef = db.collection(C.RIDE_REQUESTS).doc(offer.rideId);
    const driverRef = db.collection(C.DRIVERS).doc(driverId);
    const holdRef = db.collection(C.WALLET_TRANSACTIONS).doc(`${offer.rideId}_hold`);
    const trackingRef = db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(offer.rideId);
    const rideSnap = await tx.get(rideRef);
    const driverSnap = await tx.get(driverRef);
    const holdSnap = await tx.get(holdRef);
    if (!rideSnap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `ride not found: ${offer.rideId}`,
      });
    }
    const ride = rideSnap.data() || {};
    const driver = driverSnap.exists ? driverSnap.data() || {} : {};
    const nowMs = clock.now();

    if (ride.status === C.RIDE_STATUS.ASSIGNED && ride.acceptedDriverId === driverId) {
      return { replay: true, ride, holdAmount: Number(ride.commissionHoldCentavos || 0) };
    }
    if (ride.status !== C.RIDE_STATUS.SEARCHING) {
      throw new AppError(ERROR_CODES.RIDE_ALREADY_ACCEPTED, {
        internalMessage: `ride ${offer.rideId} status is ${ride.status}`,
      });
    }
    if (offer.status !== C.OFFER_STATUS.OFFERED) {
      throw new AppError(ERROR_CODES.OFFER_EXPIRED, {
        internalMessage: `offer ${offerId} status is ${offer.status}`,
      });
    }
    if (Number(offer.expiresAtMs || 0) <= nowMs) {
      throw new AppError(ERROR_CODES.OFFER_EXPIRED, {
        internalMessage: `offer ${offerId} expired`,
      });
    }

    if (driver.availabilityStatus !== 'online') {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, {
        internalMessage: `driver ${driverId} not online`,
      });
    }
    if (
      !hasMatchingAvailabilitySession(driver)
      || !offer.availabilitySessionId
      || offer.availabilitySessionId !== driver.availabilitySessionId
    ) {
      throw new AppError(ERROR_CODES.OFFER_EXPIRED, {
        internalMessage: `offer ${offerId} belongs to an old work session`,
        safeMetadata: { reason: 'STALE_AVAILABILITY_SESSION' },
      });
    }
    if (availabilityAgeMs(driver, nowMs) > C.AVAILABILITY_SESSION_MAX_AGE_MS) {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, {
        internalMessage: `driver ${driverId} work session is stale`,
        safeMetadata: { reason: 'STALE_AVAILABILITY_SESSION' },
      });
    }
    if (driver.activeRideId) {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, {
        internalMessage: `driver ${driverId} already on ride ${driver.activeRideId}`,
      });
    }
    if (!driverLocation(driver) || locationAgeMs(driver, nowMs) > C.LOCATION_DISPATCH_MAX_AGE_MS) {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, {
        internalMessage: 'driver location is no longer usable for a new ride',
        safeMetadata: { reason: 'STALE_DRIVER_LOCATION' },
      });
    }
    const evalResult = evaluateRideEligibility(driver, clock);
    if (!evalResult.pixKeyValid) {
      throw new AppError(ERROR_CODES.PIX_KEY_INVALID, {
        internalMessage: `driver ${driverId} has no structurally valid Pix key`,
        safeMetadata: { reason: evalResult.pixKeyReasonCode || 'PIX_KEY_INVALID' },
      });
    }
    if (!evalResult.canReceiveRides) {
      throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, {
        internalMessage: `driver ${driverId} not ride-eligible`,
        safeMetadata: {
          reason: evalResult.riskRestricted
              ? 'RISK_RESTRICTED'
              : 'DRIVER_NOT_ELIGIBLE',
          commercialPolicyVersion: evalResult.commercialPolicyVersion,
        },
      });
    }

    const commercialPolicySnapshot = buildCommercialPolicySnapshot(driver, nowMs);
    const { holdAmount, commissionFree } = resolveHold(driver, ride, nowMs);
    if (!commissionFree) {
      const available = Number(driver.walletAvailableCentavos || 0);
      if (!(available > C.MIN_WALLET_BALANCE_CENTAVOS)) {
        throw new AppError(ERROR_CODES.WALLET_INSUFFICIENT, {
          internalMessage: `wallet ${available} <= min for ${driverId}`,
        });
      }
      if (available < holdAmount) {
        throw new AppError(ERROR_CODES.WALLET_INSUFFICIENT, {
          internalMessage: `wallet ${available} < commission ${holdAmount} for ${driverId}`,
        });
      }
      if (holdAmount > 0 && holdSnap.exists) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
          internalMessage: `orphan/duplicate hold exists before ride assignment: ${offer.rideId}`,
          safeMetadata: { reason: 'COMMISSION_HOLD_ALREADY_EXISTS' },
        });
      }
    }

    const commissionPolicySnapshot = buildCommissionPolicySnapshot(
      ride,
      holdAmount,
      commissionFree,
      nowMs
    );
    const commissionSettlementStatus = holdAmount > 0 ? 'held' : 'free';
    const acceptedDriverPublic = publicDriverSummary(driver, ride.vehicleType, driverId);
    tx.set(rideRef, {
      status: C.RIDE_STATUS.ASSIGNED,
      acceptedDriverId: driverId,
      acceptedDriverPublic,
      acceptedAvailabilitySessionId: driver.availabilitySessionId,
      acceptedAtMs: nowMs,
      acceptedAt: ts(),
      commissionHoldCentavos: holdAmount,
      commissionPolicySnapshot,
      commercialPolicySnapshot,
      commissionSettlementStatus,
      reasonCode: null,
      updatedAt: ts(),
    }, { merge: true });

    const driverUpdate = { activeRideId: offer.rideId, updatedAt: ts() };
    if (holdAmount > 0) {
      driverUpdate.walletAvailableCentavos = Number(driver.walletAvailableCentavos || 0) - holdAmount;
      driverUpdate.walletHeldCentavos = Number(driver.walletHeldCentavos || 0) + holdAmount;
    }
    tx.set(driverRef, driverUpdate, { merge: true });
    tx.set(offerRef, {
      status: C.OFFER_STATUS.ACCEPTED,
      driverRideStatus: C.RIDE_STATUS.ASSIGNED,
      acceptedAtMs: nowMs,
      acceptedAt: ts(),
      exactPickup: { lat: ride.pickup.lat, lng: ride.pickup.lng, label: ride.pickup.label || null },
      updatedAt: ts(),
    }, { merge: true });

    const initialLocation = trackingLocationFromDriver(driver);
    if (initialLocation) {
      tx.set(trackingRef, {
        rideId: offer.rideId,
        driverId,
        vehicleType: driver.vehicleType === 'moto' ? 'moto' : 'car',
        location: initialLocation,
        accuracyMeters: Number.isFinite(Number(driver.locationAccuracyMeters))
          ? Number(driver.locationAccuracyMeters)
          : null,
        headingDegrees: Number.isFinite(Number(driver.locationHeadingDegrees))
          ? Number(driver.locationHeadingDegrees)
          : null,
        speedMps: Number.isFinite(Number(driver.locationSpeedMps))
          ? Number(driver.locationSpeedMps)
          : null,
        updatedAtMs: nowMs,
        updatedAt: ts(),
      }, { merge: true });
    }

    if (holdAmount > 0) {
      tx.set(holdRef, {
        driverId,
        rideId: offer.rideId,
        type: 'commission_hold',
        amountCentavos: holdAmount,
        expectedCommissionCentavos: commissionPolicySnapshot.estimatedCommissionCentavos,
        pricingConfigVersion: commissionPolicySnapshot.pricingConfigVersion,
        policyVersion: COMMISSION_POLICY_VERSION,
        commercialPolicyVersion: commercialPolicySnapshot.policyVersion,
        commissionBpsAtAcceptance: commercialPolicySnapshot.commissionBpsAtAcceptance,
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
      ride: {
        ...ride,
        status: C.RIDE_STATUS.ASSIGNED,
        acceptedDriverId: driverId,
        acceptedDriverPublic,
        acceptedAvailabilitySessionId: driver.availabilitySessionId,
        commissionHoldCentavos: holdAmount,
        commissionPolicySnapshot,
        commercialPolicySnapshot,
        commissionSettlementStatus,
      },
      holdAmount,
      commissionFree,
      commercialPolicySnapshot,
      holdAlreadyExisted: false,
    };
  });

  if (result.replay) {
    const replayMetadata = {
      operation: 'accept',
      offerId,
      rideId: result.ride.rideId,
      normalizedStatus: 'assigned',
      reasonCode: 'IDEMPOTENT_REPLAY',
      commercialPolicyVersion: result.ride.commercialPolicySnapshot?.policyVersion || null,
    };
    logInfo(context, 'ride.accept.duplicate_ignored', replayMetadata);
    // Preserve the established success event for dashboards and historical tests.
    logInfo(context, 'ride.accept.won', replayMetadata);
    return safeAcceptanceView(result.ride.rideId, result.ride, result.holdAmount);
  }

  const rideId = result.ride.rideId;
  await writeAuditLog(db, {
    actorUid: driverId,
    actorType: 'driver',
    action: 'ride_accepted',
    targetType: 'ride',
    targetId: rideId,
    traceId,
    afterSummary: {
      acceptedDriverId: driverId,
      commissionHoldCentavos: result.holdAmount,
      commissionFreeAtAcceptance: result.commissionFree,
      commissionPolicyVersion: COMMISSION_POLICY_VERSION,
      commercialPolicyVersion: result.commercialPolicySnapshot.policyVersion,
      hasApprovedDriverPhoto: Boolean(result.ride.acceptedDriverPublic?.photoStoragePath),
    },
  }, clock);

  logInfo(context, 'ride.accept.commercial_policy_frozen', {
    operation: 'accept',
    rideId,
    offerId,
    policyVersion: result.commercialPolicySnapshot.policyVersion,
    founder: result.commercialPolicySnapshot.founder,
    commissionBpsAtAcceptance: result.commercialPolicySnapshot.commissionBpsAtAcceptance,
  });

  if (result.holdAmount > 0) {
    logInfo(context, 'wallet.hold.created', {
      operation: 'accept', rideId, offerId, amountCentavos: result.holdAmount,
    });
  } else {
    logInfo(context, 'wallet.hold.not_required', {
      operation: 'accept', rideId, offerId, reasonCode: 'COMMISSION_FREE_AT_ACCEPTANCE',
    });
  }
  logInfo(context, 'ride.accept.won', {
    operation: 'accept',
    offerId,
    rideId,
    normalizedStatus: 'assigned',
    amountCentavos: result.holdAmount,
    reasonCode: result.commissionFree ? 'COMMISSION_FREE_AT_ACCEPTANCE' : null,
    hasApprovedDriverPhoto: Boolean(result.ride.acceptedDriverPublic?.photoStoragePath),
  });
  logInfo(context, 'ride.accept.exact_pickup_revealed', { operation: 'accept', rideId, offerId });

  try {
    const siblings = await db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId).get();
    const closes = [];
    siblings.forEach((document) => {
      if (document.id !== offerId && (document.data() || {}).status === C.OFFER_STATUS.OFFERED) {
        closes.push(document.ref.set({ status: C.OFFER_STATUS.CLOSED, updatedAt: ts() }, { merge: true }));
      }
    });
    await Promise.all(closes);
  } catch (error) {
    logWarning(context, 'ride.offer_cleanup_failed', {
      operation: 'accept',
      rideId,
      internalMessage: error && error.message,
    });
  }

  return safeAcceptanceView(rideId, result.ride, result.holdAmount);
}

module.exports = {
  COMMISSION_POLICY_VERSION,
  acceptDriverOfferSecure,
  resolveHold,
  buildCommissionPolicySnapshot,
  publicDriverSummary,
  trackingLocationFromDriver,
  approvedPhotoPath,
};
