// @ts-check
// Keeps a disputed ride from becoming a way to avoid DriveLocal commission while
// continuing to accept new work. A dispute freezes only NEW acceptances; it never
// changes the wallet/hold. Final admin resolution clears the restriction safely.

const admin = require('firebase-admin');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const rideC = require('../rides/constants');

const REGION = 'southamerica-east1';

async function applyPaymentReviewRestriction({ db, driverId, rideId, disputed, nowMs }) {
  if (!driverId || !rideId) return { changed: false };
  const driverRef = db.collection(rideC.DRIVERS).doc(driverId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(driverRef);
    if (!snapshot.exists) return { changed: false };
    const driver = snapshot.data() || {};

    if (disputed) {
      if (driver.financialReviewRequired === true && driver.financialReviewRideId === rideId) {
        return { changed: false };
      }
      tx.set(driverRef, {
        financialReviewRequired: true,
        financialReviewRideId: rideId,
        financialReviewSinceMs: nowMs,
        financialReviewSince: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { changed: true, restricted: true };
    }

    // Clear only the restriction created by this ride. A newer dispute must not be
    // accidentally unlocked by resolution of an older case.
    if (driver.financialReviewRideId !== rideId) return { changed: false };
    tx.set(driverRef, {
      financialReviewRequired: false,
      financialReviewRideId: null,
      financialReviewSinceMs: null,
      financialReviewResolvedAtMs: nowMs,
      financialReviewResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { changed: true, restricted: false };
  });
}

const ridePaymentRestrictionTrigger = onDocumentUpdated(
  { document: 'rideRequests/{rideId}', region: REGION, retry: true },
  async (event) => {
    const rideId = event.params.rideId;
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const driverId = after.acceptedDriverId || before.acceptedDriverId;
    const enteredDispute = before.status !== rideC.RIDE_STATUS.DISPUTED
      && after.status === rideC.RIDE_STATUS.DISPUTED;
    const resolvedDispute = before.status === rideC.RIDE_STATUS.DISPUTED
      && [rideC.RIDE_STATUS.COMPLETED, rideC.RIDE_STATUS.CANCELLED].includes(after.status);
    if (!enteredDispute && !resolvedDispute) return null;

    const context = createLoggerContext({ functionName: 'ridePaymentRestrictionTrigger', actorType: 'system' });
    try {
      const result = await applyPaymentReviewRestriction({
        db: event.data.after.ref.firestore,
        driverId,
        rideId,
        disputed: enteredDispute,
        nowMs: Date.now(),
      });
      logInfo(context, enteredDispute
        ? 'driver.financial_review_restricted'
        : 'driver.financial_review_cleared', {
        operation: 'payment_review_restriction',
        rideId,
        result: result.changed ? 'changed' : 'unchanged',
      });
    } catch (error) {
      logWarning(context, 'driver.financial_review_restriction_failed', {
        operation: 'payment_review_restriction',
        rideId,
        internalMessage: error?.message,
      });
      throw error;
    }
    return null;
  }
);

module.exports = {
  applyPaymentReviewRestriction,
  ridePaymentRestrictionTrigger,
};
