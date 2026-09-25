// @ts-check
// Callable bindings for the secure driver domain. Each is a thin v2 onCall
// wrapped by the single error boundary; all real logic lives in handlers.

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { withCallableBoundary } = require('../errors/boundary');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { systemClock } = require('../time/clock');
const { approveDriver } = require('./approveDriver');
const { rejectDriver, blockDriver, unblockDriver, suspendDriver, reactivateDriver } = require('./moderateDriver');
const { approveDriverPhoto, rejectDriverPhoto } = require('./photoReview');
const { setDriverAvailability } = require('./availability');
const { getDriverRideHistory } = require('./history');

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
  // Retain the deployed callable name as a no-charge bridge for old APKs.
  activateSubscriptionSecure: bind('activateSubscriptionSecure', async () => {
    throw new AppError(ERROR_CODES.APP_UPDATE_REQUIRED);
  }),
  approveDriverPhotoSecure: bind('approveDriverPhotoSecure', approveDriverPhoto),
  rejectDriverPhotoSecure: bind('rejectDriverPhotoSecure', rejectDriverPhoto),
  setDriverAvailabilitySecure: bind('setDriverAvailabilitySecure', setDriverAvailability),
  getDriverRideHistorySecure: bind('getDriverRideHistorySecure', getDriverRideHistory),
};
