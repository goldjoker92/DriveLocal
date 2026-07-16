// @ts-check
// Callable bindings for the secure driver domain. Each is a thin v2 onCall
// wrapped by the single error boundary; all real logic lives in the pure,
// clock-injected handlers so tests stay deterministic. Firestore is resolved
// lazily inside the handler (Admin app is initialized in index.js).

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { approveDriver } = require('./approveDriver');
const { rejectDriver, blockDriver, unblockDriver, suspendDriver, reactivateDriver } = require('./moderateDriver');
const { activateSubscription } = require('./activateSubscription');

const REGION = 'southamerica-east1';

function bind(name, handler) {
  return onCall(
    { region: REGION },
    withCallableBoundary(name, (request, context) =>
      handler({ db: admin.firestore(), request, context, clock: systemClock })
    )
  );
}

module.exports = {
  approveDriverSecure: bind('approveDriverSecure', approveDriver),
  rejectDriverSecure: bind('rejectDriverSecure', rejectDriver),
  blockDriverSecure: bind('blockDriverSecure', blockDriver),
  unblockDriverSecure: bind('unblockDriverSecure', unblockDriver),
  suspendDriverSecure: bind('suspendDriverSecure', suspendDriver),
  reactivateDriverSecure: bind('reactivateDriverSecure', reactivateDriver),
  activateSubscriptionSecure: bind('activateSubscriptionSecure', activateSubscription),
};
