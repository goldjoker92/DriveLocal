// @ts-check
// Projects a private passenger profile into the accepted driver's existing offer.
// The trigger is retryable and idempotent; it never runs before a driver is assigned.

const admin = require('firebase-admin');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const {
  buildAcceptedPassengerPublic,
  DEFAULT_FIRST_NAME,
  isPublicPassengerPhotoPath,
} = require('./passengerPublicIdentity');
const C = require('./constants');

const REGION = 'southamerica-east1';
const PROJECTION_VERSION = 'accepted-passenger-public-v1';

function closedProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== 'firstName|photoStoragePath|photoVerified') return null;
  if (typeof value.firstName !== 'string' || !value.firstName.trim()) return null;
  if (typeof value.photoVerified !== 'boolean') return null;
  if (value.photoStoragePath !== null && !isPublicPassengerPhotoPath(value.photoStoragePath)) return null;
  if (value.photoVerified !== Boolean(value.photoStoragePath)) return null;
  return {
    firstName: value.firstName,
    photoStoragePath: value.photoStoragePath,
    photoVerified: value.photoVerified,
  };
}

function sameProjection(left, right) {
  const a = closedProjection(left);
  const b = closedProjection(right);
  return Boolean(
    a && b
    && a.firstName === b.firstName
    && a.photoStoragePath === b.photoStoragePath
    && a.photoVerified === b.photoVerified
  );
}

function identityProjectionNeeded(_before = {}, after = {}) {
  if (!after.passengerId || !after.acceptedDriverId) return false;
  if (after.status === C.RIDE_STATUS.SEARCHING) return false;
  // A valid projection written by this trigger must not schedule one redundant
  // invocation. Malformed/legacy maps are replaced with the closed safe shape.
  return !closedProjection(after.acceptedPassengerPublic);
}

async function syncAcceptedPassengerIdentity({ db, rideId, context }) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const result = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) return { action: 'ride_missing' };

    const ride = rideSnap.data() || {};
    if (!ride.passengerId || !ride.acceptedDriverId) return { action: 'not_assigned' };

    const passengerRef = db.collection(C.PASSENGERS).doc(ride.passengerId);
    const offerRef = db.collection(C.DRIVER_OFFERS).doc(`${rideId}_${ride.acceptedDriverId}`);
    const passengerSnap = await tx.get(passengerRef);
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists) return { action: 'accepted_offer_missing' };

    const passenger = passengerSnap.exists ? passengerSnap.data() || {} : {};
    const projection = buildAcceptedPassengerPublic(passenger);
    const offer = offerSnap.data() || {};

    if (
      sameProjection(ride.acceptedPassengerPublic, projection)
      && sameProjection(offer.acceptedPassengerPublic, projection)
    ) {
      return { action: 'duplicate_ignored', projection };
    }

    const projectedAtMs = Date.now();
    const update = {
      acceptedPassengerPublic: projection,
      passengerIdentityProjectionVersion: PROJECTION_VERSION,
      passengerIdentityProjectedAtMs: projectedAtMs,
      passengerIdentityProjectedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    tx.set(rideRef, update, { merge: true });
    tx.set(offerRef, update, { merge: true });
    return { action: 'succeeded', projection };
  });

  const metadata = {
    operation: 'project_accepted_passenger_identity',
    rideId,
    projectionVersion: PROJECTION_VERSION,
    result: result.action,
    firstNameFallback: result.projection?.firstName === DEFAULT_FIRST_NAME,
    photoVerified: result.projection?.photoVerified === true,
  };
  if (result.action === 'accepted_offer_missing') {
    logWarning(context, 'ride.passenger_identity_projection.offer_missing', metadata);
  } else if (result.action === 'duplicate_ignored') {
    logInfo(context, 'ride.passenger_identity_projection.duplicate_ignored', metadata);
  } else {
    logInfo(context, 'ride.passenger_identity_projection.completed', metadata);
  }
  return result;
}

const acceptedPassengerIdentityTrigger = onDocumentUpdated(
  {
    document: `${C.RIDE_REQUESTS}/{rideId}`,
    region: REGION,
    retry: true,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!identityProjectionNeeded(before, after)) return null;

    const context = createLoggerContext({
      functionName: 'acceptedPassengerIdentityTrigger',
      actorType: 'system',
    });
    logInfo(context, 'ride.passenger_identity_projection.started', {
      operation: 'project_accepted_passenger_identity',
      rideId: event.params.rideId,
      projectionVersion: PROJECTION_VERSION,
    });

    try {
      await syncAcceptedPassengerIdentity({
        db: event.data.after.ref.firestore,
        rideId: event.params.rideId,
        context,
      });
    } catch (error) {
      logWarning(context, 'ride.passenger_identity_projection.failed', {
        operation: 'project_accepted_passenger_identity',
        rideId: event.params.rideId,
        projectionVersion: PROJECTION_VERSION,
        errorCode: error?.code || error?.name || 'IDENTITY_PROJECTION_FAILED',
      });
      throw error;
    }
    return null;
  }
);

module.exports = {
  PROJECTION_VERSION,
  closedProjection,
  sameProjection,
  identityProjectionNeeded,
  syncAcceptedPassengerIdentity,
  acceptedPassengerIdentityTrigger,
};
