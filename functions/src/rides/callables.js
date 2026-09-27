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
const { getRideQuoteSecure } = require('./rideQuote');
const { acceptDriverOfferSecure } = require('./acceptOffer');
const { declineDriverOfferSecure } = require('./declineOffer');
const { markDriverArrived } = require('./markDriverArrived');
const { cancelRide } = require('./cancelRide');
const { normalizedCancellationRequest } = require('./cancellationCompatibility');
const { sendRideQuickMessage } = require('./sendQuickMessage');
const { openRideConversation, sendRideMessage } = require('./ride-messages');
const { getPassengerRideHistory } = require('./passengerHistory');
const lifecycle = require('./lifecycle');
const {
  safeDriverAcceptanceView,
  safeDriverLifecycleView,
} = require('./safeViews');
const { resolveRideDispute } = require('./disputeResolution');
const { getAdminRideSummary, listAdminDisputedRides } = require('./adminReads');
const { syncDriverPixKeyForRide } = require('../pix/driverPixSync');
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

// Synchronize keys saved by older app versions before the server builds the
// payment payload. The helper validates and never logs the raw key.
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

const getRideQuoteSecureFn = onCall(
  { region: REGION, secrets: [ROUTING_PROVIDER_API_KEY] },
  withCallableBoundary('getRideQuoteSecure', (request, context) =>
    getRideQuoteSecure({
      db: admin.firestore(), request,
      context: { ...context, environment: resolveEnvironment() },
      clock: systemClock,
      routingAdapter: createGoogleRoutesAdapter({ apiKey: ROUTING_PROVIDER_API_KEY.value() }),
    })
  )
);

const createRideFromQuoteSecureFn = onCall(
  { region: REGION, secrets: [ROUTING_PROVIDER_API_KEY] },
  withCallableBoundary('createRideFromQuoteSecure', (request, context) =>
    createRideRequestSecure({
      db: admin.firestore(), request,
      context: { ...context, environment: resolveEnvironment() },
      clock: systemClock, requireQuote: true,
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
  getRideQuoteSecure: getRideQuoteSecureFn,
  createRideFromQuoteSecure: createRideFromQuoteSecureFn,
  createRideRequestSecure: createRideRequestSecureFn,
  acceptDriverOfferSecure: acceptDriverOfferSecureFn,
  declineDriverOfferSecure: declineDriverOfferSecureFn,
  markDriverArrivedSecure: bindLifecycle('markDriverArrivedSecure', markDriverArrived),
  startRideSecure: bindLifecycle('startRideSecure', lifecycle.startRide),
  finishRideSecure: bindLifecycle('finishRideSecure', finishRideWithPixMigration),
  markPassengerPixSentSecure: bindLifecycle('markPassengerPixSentSecure', lifecycle.markPassengerPixSent),
  confirmDriverPixReceivedSecure: bindLifecycle('confirmDriverPixReceivedSecure', confirmDriverPixReceivedPublic),
  cancelRideSecure: bindLifecycle('cancelRideSecure', cancelRideWithCompatibility),
  openRideConversationSecure: bindLifecycle('openRideConversationSecure', openRideConversation),
  sendRideMessageSecure: bindLifecycle('sendRideMessageSecure', sendRideMessage),
  sendRideQuickMessageSecure: bindLifecycle('sendRideQuickMessageSecure', sendRideQuickMessage),
  reportRidePaymentIssueSecure: bindLifecycle('reportRidePaymentIssueSecure', lifecycle.reportRidePaymentIssue),
  resolveRideDisputeSecure: bindLifecycle('resolveRideDisputeSecure', resolveRideDispute),
  getPassengerRideHistorySecure: bindLifecycle('getPassengerRideHistorySecure', getPassengerRideHistory),
  getAdminRideSummarySecure: bindLifecycle('getAdminRideSummarySecure', getAdminRideSummary),
  listAdminDisputedRidesSecure: bindLifecycle('listAdminDisputedRidesSecure', listAdminDisputedRides),
  SECRET_PARAMS: { ROUTING_PROVIDER_API_KEY },
  acceptDriverOfferPublic,
  confirmDriverPixReceivedPublic,
};
