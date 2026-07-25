// @ts-check
// Keeps an unresolved payment from becoming a way to avoid DriveLocal commission
// while continuing to accept new work. The restriction affects NEW acceptances
// only; it never changes the wallet/hold or interrupts the current ride. Any final
// settlement clears only the restriction linked to that exact ride.

const admin = require('firebase-admin');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const rideC = require('../rides/constants');

const REGION = 'southamerica-east1';
const MAX_TRACKED_PAYMENT_REVIEWS = 50;

function paymentReviewRideIds(driver = {}) {
  const ids = [];
  if (Array.isArray(driver.financialReviewRideIds)) {
    driver.financialReviewRideIds.forEach((value) => {
      const id = typeof value === 'string' ? value.trim() : '';
      if (id && !ids.includes(id)) ids.push(id);
    });
  }
  const legacyId = typeof driver.financialReviewRideId === 'string'
    ? driver.financialReviewRideId.trim()
    : '';
  if (legacyId && !ids.includes(legacyId)) ids.push(legacyId);
  return ids.slice(-MAX_TRACKED_PAYMENT_REVIEWS);
}

async function applyPaymentReviewRestriction({ db, driverId, rideId, disputed, nowMs }) {
  if (!driverId || !rideId) return { changed: false };
  const driverRef = db.collection(rideC.DRIVERS).doc(driverId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(driverRef);
    if (!snapshot.exists) return { changed: false };
    const driver = snapshot.data() || {};
    const reviewRideIds = paymentReviewRideIds(driver);

    if (disputed) {
      if (reviewRideIds.includes(rideId)) return { changed: false };
      const nextIds = [...reviewRideIds, rideId].slice(-MAX_TRACKED_PAYMENT_REVIEWS);
      tx.set(driverRef, {
        financialReviewRequired: true,
        financialReviewRideIds: nextIds,
        // Compatibility field for older admin/mobile builds. The array above is the
        // authoritative set and prevents one resolved ride from unlocking another.
        financialReviewRideId: rideId,
        financialReviewSinceMs: nowMs,
        financialReviewSince: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { changed: true, restricted: true, remainingReviewCount: nextIds.length };
    }

    if (!reviewRideIds.includes(rideId)) return { changed: false };
    const remainingIds = reviewRideIds.filter((id) => id !== rideId);
    tx.set(driverRef, {
      financialReviewRequired: remainingIds.length > 0,
      financialReviewRideIds: remainingIds,
      financialReviewRideId: remainingIds.length > 0
        ? remainingIds[remainingIds.length - 1]
        : null,
      financialReviewSinceMs: remainingIds.length > 0
        ? driver.financialReviewSinceMs || nowMs
        : null,
      financialReviewResolvedAtMs: nowMs,
      financialReviewResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      changed: true,
      restricted: remainingIds.length > 0,
      remainingReviewCount: remainingIds.length,
    };
  });
}

function paymentRestrictionTransition(beforeStatus, afterStatus, disputedBy = null) {
  const enteredDispute = beforeStatus !== rideC.RIDE_STATUS.DISPUTED
    && afterStatus === rideC.RIDE_STATUS.DISPUTED;
  const becameFinal = beforeStatus !== afterStatus
    && [rideC.RIDE_STATUS.COMPLETED, rideC.RIDE_STATUS.CANCELLED].includes(afterStatus);

  // A passenger may report a bad Pix key or another driver-side issue. That report
  // opens a review case, but must not instantly let a malicious passenger disable a
  // driver. Driver-opened non-receipt disputes and legacy disputes are restricted;
  // any unresolved payment older than 24 h is also restricted by reconciliation.
  const restrict = enteredDispute && disputedBy !== 'passenger';
  return {
    shouldHandle: restrict || becameFinal,
    restrict,
    enteredDispute,
    becameFinal,
  };
}

const ridePaymentRestrictionTrigger = onDocumentUpdated(
  { document: 'rideRequests/{rideId}', region: REGION, retry: true },
  async (event) => {
    const rideId = event.params.rideId;
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const driverId = after.acceptedDriverId || before.acceptedDriverId;
    const transition = paymentRestrictionTransition(
      before.status,
      after.status,
      after.disputedBy || null
    );
    if (!transition.shouldHandle) return null;

    const context = createLoggerContext({
      functionName: 'ridePaymentRestrictionTrigger',
      actorType: 'system',
    });
    try {
      const result = await applyPaymentReviewRestriction({
        db: event.data.after.ref.firestore,
        driverId,
        rideId,
        disputed: transition.restrict,
        nowMs: Date.now(),
      });
      logInfo(context, transition.restrict
        ? 'driver.financial_review_restricted'
        : 'driver.financial_review_cleared', {
        operation: 'payment_review_restriction',
        rideId,
        result: result.changed ? 'changed' : 'unchanged',
        finalStatus: transition.becameFinal ? after.status : null,
        remainingReviewCount: result.remainingReviewCount || 0,
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
  MAX_TRACKED_PAYMENT_REVIEWS,
  paymentReviewRideIds,
  applyPaymentReviewRestriction,
  paymentRestrictionTransition,
  ridePaymentRestrictionTrigger,
};
