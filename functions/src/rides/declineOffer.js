// @ts-check
// Driver refusal/expiry for a targeted offer. The backend closes only the
// authenticated driver's offer. If no live offer remains, the passenger search
// and activeRideId are closed together.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const C = require('./constants');

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

async function finishSearchWhenNoLiveOffer({ db, rideId, nowMs, context }) {
  const offersSnap = await db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId).get();
  let hasLiveOffer = false;
  offersSnap.forEach((doc) => {
    const offer = doc.data() || {};
    if (offer.status === C.OFFER_STATUS.OFFERED && Number(offer.expiresAtMs || 0) > nowMs) {
      hasLiveOffer = true;
    }
  });
  if (hasLiveOffer) return false;

  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const result = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) return { closed: false, passengerStateCleared: false };
    const ride = rideSnap.data() || {};
    if (ride.status !== C.RIDE_STATUS.SEARCHING) {
      return { closed: false, passengerStateCleared: false };
    }

    const passengerRef = ride.passengerId
      ? db.collection(C.PASSENGERS).doc(ride.passengerId)
      : null;
    const passengerSnap = passengerRef ? await tx.get(passengerRef) : null;

    tx.set(rideRef, {
      status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
      reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS,
      updatedAt: ts(),
    }, { merge: true });

    let passengerStateCleared = false;
    if (
      passengerRef
      && passengerSnap?.exists
      && (passengerSnap.data() || {}).activeRideId === rideId
    ) {
      tx.set(
        passengerRef,
        { activeRideId: null, updatedAt: ts() },
        { merge: true }
      );
      passengerStateCleared = true;
    }

    return { closed: true, passengerStateCleared };
  });

  if (!result.closed) return false;
  logInfo(context, 'ride.dispatch.all_offers_closed', {
    operation: 'decline_offer',
    rideId,
    normalizedStatus: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
    reasonCode: C.REASON.NO_ELIGIBLE_DRIVERS,
    passengerStateCleared: result.passengerStateCleared,
  });
  return true;
}

async function declineDriverOfferSecure({ db, request, context, clock }) {
  const driverId = request && request.auth && request.auth.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'offer decline without authentication',
    });
  }

  const payload = assertShape(request && request.data, {
    required: ['offerId'],
    optional: ['reasonCode'],
  });
  const offerId = validateIdentifier(payload.offerId, 'offerId');
  const offerRef = db.collection(C.DRIVER_OFFERS).doc(offerId);
  const nowMs = clock.now();
  let rideId = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(offerRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `offer not found: ${offerId}`,
      });
    }
    const offer = snap.data() || {};
    if (offer.driverId !== driverId) {
      throw new AppError(ERROR_CODES.FORBIDDEN, {
        internalMessage: 'driver attempted to decline another driver offer',
      });
    }
    rideId = offer.rideId;
    if (offer.status !== C.OFFER_STATUS.OFFERED) return;
    tx.set(offerRef, {
      status: C.OFFER_STATUS.CLOSED,
      declineReason: payload.reasonCode === 'expired' ? 'expired' : 'driver_declined',
      declinedAtMs: nowMs,
      declinedAt: ts(),
      updatedAt: ts(),
    }, { merge: true });
  });

  if (rideId) await finishSearchWhenNoLiveOffer({ db, rideId, nowMs, context });
  return { offerId, rideId, status: 'closed' };
}

module.exports = { declineDriverOfferSecure, finishSearchWhenNoLiveOffer };
