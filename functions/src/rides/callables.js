// @ts-check
// Callable bindings for the ride request / dispatch / acceptance domain. Thin
// adapters over the pure clock-injected handlers.
//
// Per the final scope: there are NO callable wrappers for safe reads. The
// passenger listens to their own rideRequests/{rideId} and the driver listens to
// driverOffers where driverId == auth.uid — BLOCK 04 Rules already secure both.
//
// The routing provider API key is a Secret Manager parameter
// (ROUTING_PROVIDER_API_KEY), bound only to createRideRequestSecure (the only
// function that measures a route). Its value is never read or logged here.

const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { resolveEnvironment } = require('../config/environment');
const { createGoogleRoutesAdapter } = require('../routing/googleRoutes');
const { createRideRequestSecure } = require('./createRideRequest');
const { acceptDriverOfferSecure } = require('./acceptOffer');
const lifecycle = require('./lifecycle');
const { resolveRideDispute } = require('./disputeResolution');

const REGION = 'southamerica-east1';

// Binds a lifecycle handler (Firestore + systemClock injected) to a callable.
function bindLifecycle(name, handler) {
  return onCall(
    { region: REGION },
    withCallableBoundary(name, (request, context) =>
      handler({ db: admin.firestore(), request, context, clock: systemClock })
    )
  );
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

module.exports = {
  createRideRequestSecure: createRideRequestSecureFn,
  acceptDriverOfferSecure: acceptDriverOfferSecureFn,
  markDriverArrivedSecure: bindLifecycle('markDriverArrivedSecure', lifecycle.markDriverArrived),
  startRideSecure: bindLifecycle('startRideSecure', lifecycle.startRide),
  finishRideSecure: bindLifecycle('finishRideSecure', lifecycle.finishRide),
  markPassengerPixSentSecure: bindLifecycle('markPassengerPixSentSecure', lifecycle.markPassengerPixSent),
  confirmDriverPixReceivedSecure: bindLifecycle('confirmDriverPixReceivedSecure', lifecycle.confirmDriverPixReceived),
  cancelRideSecure: bindLifecycle('cancelRideSecure', lifecycle.cancelRide),
  reportRidePaymentIssueSecure: bindLifecycle('reportRidePaymentIssueSecure', lifecycle.reportRidePaymentIssue),
  resolveRideDisputeSecure: bindLifecycle('resolveRideDisputeSecure', resolveRideDispute),
  SECRET_PARAMS: { ROUTING_PROVIDER_API_KEY },
};
