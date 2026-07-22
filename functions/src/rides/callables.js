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
const lifecycle = require('./lifecycle');
const { resolveRideDispute } = require('./disputeResolution');
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
    acceptDriverOfferSecure({ db: admin.firestore(), request, context, clock: systemClock })
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
  markDriverArrivedSecure: bindLifecycle('markDriverArrivedSecure', lifecycle.markDriverArrived),
  startRideSecure: bindLifecycle('startRideSecure', lifecycle.startRide),
  finishRideSecure: bindLifecycle('finishRideSecure', finishRideWithPixMigration),
  markPassengerPixSentSecure: bindLifecycle('markPassengerPixSentSecure', lifecycle.markPassengerPixSent),
  confirmDriverPixReceivedSecure: bindLifecycle('confirmDriverPixReceivedSecure', lifecycle.confirmDriverPixReceived),
  cancelRideSecure: bindLifecycle('cancelRideSecure', lifecycle.cancelRide),
  reportRidePaymentIssueSecure: bindLifecycle('reportRidePaymentIssueSecure', lifecycle.reportRidePaymentIssue),
  resolveRideDisputeSecure: bindLifecycle('resolveRideDisputeSecure', resolveRideDispute),
  SECRET_PARAMS: { ROUTING_PROVIDER_API_KEY },
};
