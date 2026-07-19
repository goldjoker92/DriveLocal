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

const REGION = 'southamerica-east1';

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
  finishRideSecure: bindLifecycle('finishRideSecure', lifecycle.finishRide),
  markPassengerPixSentSecure: bindLifecycle('markPassengerPixSentSecure', lifecycle.markPassengerPixSent),
  confirmDriverPixReceivedSecure: bindLifecycle('confirmDriverPixReceivedSecure', lifecycle.confirmDriverPixReceived),
  cancelRideSecure: bindLifecycle('cancelRideSecure', lifecycle.cancelRide),
  reportRidePaymentIssueSecure: bindLifecycle('reportRidePaymentIssueSecure', lifecycle.reportRidePaymentIssue),
  resolveRideDisputeSecure: bindLifecycle('resolveRideDisputeSecure', resolveRideDispute),
  SECRET_PARAMS: { ROUTING_PROVIDER_API_KEY },
};
