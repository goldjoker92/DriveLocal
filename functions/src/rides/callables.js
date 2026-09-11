// @ts-check
// Callable bindings for the ride request / dispatch / acceptance domain. Thin
// adapters over the pure clock-injected handlers.

const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { logInfo } = require('../logging/logger');
const { systemClock } = require('../time/clock');
const { resolveEnvironment } = require('../config/environment');
const { createGoogleRoutesAdapter } = require('../routing/googleRoutes');
const { createRideRequestSecure } = require('./createRideRequest');
const { acceptDriverOfferSecure } = require('./acceptOffer');
const { declineDriverOfferSecure } = require('./declineOffer');
const { markDriverArrived } = require('./markDriverArrived');
const { cancelRide } = require('./cancelRide');
const { normalizedCancellationRequest } = require('./cancellationCompatibility');
const { sendRideQuickMessage } = require('./sendQuickMessage');
const { getPassengerRideHistory } = require('./passengerHistory');
const lifecycle = require('./lifecycle');
const {
  safeDriverAcceptanceView,
  safeDriverLifecycleView,
} = require('./safeViews');
const { resolveRideDispute } = require('./disputeResolution');
const { getAdminRideSummary, listAdminDisputedRides } = require('./adminReads');
const { normalizePixKey } = require('../pix/pixKey');
const C = require('./constants');

const REGION = 'southamerica-east1';

function bindLifecycle(name, handler) {
  return onCall(
    { region: REGION },
    withCallableBoundary(name, (request, context) =>
      handler({ db: admin.firestore(), request, context, clock: systemClock })
    )
  );
}

async function cancelRideWithCompatibility({ db, request, context, clock }) {
  return cancelRide({
    db,
    request: normalizedCancellationRequest(request),
    context,
    clock,
  });
}

// Older builds write Pix fields on drivers/{uid}, while ride settlement reads
// privateDriverData/{uid}. Normalize the public value and synchronize both copies
// transactionally before finishing. A valid private value is preserved when a
// malformed legacy public value is encountered.
async function syncDriverPixKeyForRide({ db, driverId }) {
  if (!driverId) return { synced: false, reasonCode: 'UNAUTHENTICATED' };

  const driverRef = db.collection(C.DRIVERS).doc(driverId);
  const privateRef = db.collection(C.PRIVATE_DRIVER_DATA).doc(driverId);

  return db.runTransaction(async (tx) => {
    const driverSnap = await tx.get(driverRef);
    const privateSnap = await tx.get(privateRef);
    const driver = driverSnap.exists ? driverSnap.data() || {} : {};
    const privateData = privateSnap.exists ? privateSnap.data() || {} : {};
    const publicPix = normalizePixKey(driver.pixKey, driver.pixKeyType);
    const privatePix = normalizePixKey(privateData.pixKey, privateData.pixKeyType);

    if (!publicPix.valid) {
      return {
        synced: false,
        reasonCode: publicPix.reasonCode,
        privateKeyValid: privatePix.valid,
      };
    }

    const publicNeedsNormalization = driver.pixKey !== publicPix.key
      || driver.pixKeyType !== publicPix.pixKeyType;
    const privateNeedsSync = !privatePix.valid
      || privatePix.key !== publicPix.key
      || privatePix.keyType !== publicPix.keyType;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    if (publicNeedsNormalization) {
      tx.set(driverRef, {
        pixKey: publicPix.key,
        pixKeyType: publicPix.pixKeyType,
        pixKeyNormalizedAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
    }
    if (privateNeedsSync) {
      tx.set(privateRef, {
        pixKey: publicPix.key,
        pixKeyType: publicPix.pixKeyType,
        pixOwnerName: driver.pixOwnerName || driver.fullName || null,
        syncedFromDriverProfileAt: timestamp,
      }, { merge: true });
    }

    return {
      synced: publicNeedsNormalization || privateNeedsSync,
      reasonCode: null,
      privateKeyValid: true,
    };
  });
}

async function finishRideWithPixMigration({ db, request, context, clock }) {
  const driverId = request?.auth?.uid;
  if (driverId) await syncDriverPixKeyForRide({ db, driverId });
  return lifecycle.finishRide({ db, request, context, clock });
}

// Core acceptance keeps exact hold values for backend ledger/audit tests. Only the
// closed 0/12/15 percentage crosses the callable boundary to the driver app.
async function acceptDriverOfferPublic(args) {
  const result = await acceptDriverOfferSecure(args);
  const safeView = safeDriverAcceptanceView(result);
  logInfo(args.context, 'ride.accept.public_view_sanitized', {
    operation: 'accept',
    rideId: safeView.rideId,
    status: safeView.status,
    commissionDisplayBps: safeView.commissionDisplayBps,
    exactCommissionExcluded: true,
  });
  return safeView;
}

// The internal lifecycle returns exact capture values for ledger/audit tests. The
// public driver callable deliberately strips those values before crossing the
// trust boundary to the mobile application.
async function confirmDriverPixReceivedPublic(args) {
  const result = await lifecycle.confirmDriverPixReceived(args);
  const safeView = safeDriverLifecycleView(result);
  logInfo(args.context, 'ride.complete.public_view_sanitized', {
    operation: 'confirm_paid',
    rideId: safeView.rideId,
    status: safeView.status,
    exactCommissionExcluded: true,
  });
  return safeView;
}

const ROUTING_PROVIDER_API_KEY = defineSecret('ROUTING_PROVIDER_API_KEY');

const createRideRequestSecureFn = onCall(
  { region: REGION, secrets: [ROUTING_PROVIDER_API_KEY] },
  withCallableBoundary('createRideRequestSecure', (request, context) =>
    createRideRequestSecure({
      db: admin.firestore(),
      request,
      context: { ...context, environment: resolveEnvironment() },
      clock: systemClock,
      routingAdapter: createGoogleRoutesAdapter({ apiKey: ROUTING_PROVIDER_API_KEY.value() }),
    })
  )
);

const acceptDriverOfferSecureFn = onCall(
  { region: REGION },
  withCallableBoundary('acceptDriverOfferSecure', (request, context) =>
    acceptDriverOfferPublic({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

const declineDriverOfferSecureFn = onCall(
  { region: REGION },
  withCallableBoundary('declineDriverOfferSecure', (request, context) =>
    declineDriverOfferSecure({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

module.exports = {
  createRideRequestSecure: createRideRequestSecureFn,
  acceptDriverOfferSecure: acceptDriverOfferSecureFn,
  declineDriverOfferSecure: declineDriverOfferSecureFn,
  markDriverArrivedSecure: bindLifecycle('markDriverArrivedSecure', markDriverArrived),
  startRideSecure: bindLifecycle('startRideSecure', lifecycle.startRide),
  finishRideSecure: bindLifecycle('finishRideSecure', finishRideWithPixMigration),
  markPassengerPixSentSecure: bindLifecycle('markPassengerPixSentSecure', lifecycle.markPassengerPixSent),
  confirmDriverPixReceivedSecure: bindLifecycle('confirmDriverPixReceivedSecure', confirmDriverPixReceivedPublic),
  cancelRideSecure: bindLifecycle('cancelRideSecure', cancelRideWithCompatibility),
  sendRideQuickMessageSecure: bindLifecycle('sendRideQuickMessageSecure', sendRideQuickMessage),
  reportRidePaymentIssueSecure: bindLifecycle('reportRidePaymentIssueSecure', lifecycle.reportRidePaymentIssue),
  resolveRideDisputeSecure: bindLifecycle('resolveRideDisputeSecure', resolveRideDispute),
  getPassengerRideHistorySecure: bindLifecycle('getPassengerRideHistorySecure', getPassengerRideHistory),
  getAdminRideSummarySecure: bindLifecycle('getAdminRideSummarySecure', getAdminRideSummary),
  listAdminDisputedRidesSecure: bindLifecycle('listAdminDisputedRidesSecure', listAdminDisputedRides),
  SECRET_PARAMS: { ROUTING_PROVIDER_API_KEY },
  acceptDriverOfferPublic,
  confirmDriverPixReceivedPublic,
  syncDriverPixKeyForRide,
};