// @ts-check
// Callable bindings for the ride request / dispatch / acceptance domain. Thin
// adapters over the pure clock-injected handlers.

const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
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
const lifecycle = require('./lifecycle');
const {
  safeDriverAcceptanceView,
  safeDriverLifecycleView,
} = require('./safeViews');
const { resolveRideDispute } = require('./disputeResolution');
const { getAdminRideSummary, listAdminDisputedRides } = require('./adminReads');
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

// Older driver profiles store Pix fields on drivers/{uid}, while the secure ride
// lifecycle reads privateDriverData/{uid}. Migrate that already-authenticated
// driver's data server-side before finishing so existing approved accounts can
// complete a ride without weakening the payment destination checks.
async function finishRideWithPixMigration({ db, request, context, clock }) {
  const driverId = request?.auth?.uid;
  if (driverId) {
    const privateRef = db.collection(C.PRIVATE_DRIVER_DATA).doc(driverId);
    const privateSnap = await privateRef.get();
    const privateData = privateSnap.exists ? privateSnap.data() || {} : {};

    if (!privateData.pixKey) {
      const driverSnap = await db.collection(C.DRIVERS).doc(driverId).get();
      const driver = driverSnap.exists ? driverSnap.data() || {} : {};
      const legacyPixKey = typeof driver.pixKey === 'string' ? driver.pixKey.trim() : '';

      if (legacyPixKey) {
        await privateRef.set(
          {
            pixKey: legacyPixKey,
            pixKeyType: driver.pixKeyType || null,
            pixOwnerName: driver.pixOwnerName || driver.fullName || null,
            migratedFromDriverProfileAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  }

  return lifecycle.finishRide({ db, request, context, clock });
}

// Core acceptance keeps exact hold values for backend ledger/audit tests. Only the
// closed 0/12/15 percentage crosses the callable boundary to the driver app.
async function acceptDriverOfferPublic(args) {
  const result = await acceptDriverOfferSecure(args);
  return safeDriverAcceptanceView(result);
}

// The internal lifecycle returns exact capture values for ledger/audit tests. The
// public driver callable deliberately strips those values before crossing the
// trust boundary to the mobile application.
async function confirmDriverPixReceivedPublic(args) {
  const result = await lifecycle.confirmDriverPixReceived(args);
  return safeDriverLifecycleView(result);
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
  getAdminRideSummarySecure: bindLifecycle('getAdminRideSummarySecure', getAdminRideSummary),
  listAdminDisputedRidesSecure: bindLifecycle('listAdminDisputedRidesSecure', listAdminDisputedRides),
  SECRET_PARAMS: { ROUTING_PROVIDER_API_KEY },
  acceptDriverOfferPublic,
  confirmDriverPixReceivedPublic,
};