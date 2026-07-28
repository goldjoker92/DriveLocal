// @ts-check
// Safe authenticated restoration for the driver's latest subscription Pix.
// Raw paymentRequests stay server-only; the app receives only the same normalized
// fields already exposed by getDriverPaymentStatus.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const { safePaymentView } = require('./paymentStatus');
const C = require('./constants');

const SNAPSHOT_VERSION = 'driver-subscription-payment-snapshot-v1';
const RESTORABLE_STATUSES = new Set([C.STATUS.PENDING, C.STATUS.MANUAL_REVIEW]);

async function getDriverSubscriptionSnapshot({ db, request, context, clock }) {
  const driverId = request?.auth?.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'subscription snapshot requested without authentication',
    });
  }
  assertShape(request?.data || {}, {});

  const snapshot = await db.collection(C.PAYMENT_REQUESTS)
    .where('driverId', '==', driverId)
    .where('purpose', '==', 'driver_subscription')
    .orderBy('createdAtMs', 'desc')
    .limit(1)
    .get();
  const latest = snapshot.docs[0] || null;
  const data = latest ? latest.data() || {} : null;
  const restorable = Boolean(
    latest
    && data
    && RESTORABLE_STATUSES.has(data.status)
  );

  logInfo(context, 'subscription.snapshot.loaded', {
    operation: 'get_driver_subscription_snapshot',
    snapshotVersion: SNAPSHOT_VERSION,
    hasLatestPayment: Boolean(latest),
    restorable,
    normalizedStatus: data?.status || null,
  });

  return {
    version: SNAPSHOT_VERSION,
    generatedAtMs: clock.now(),
    payment: restorable ? safePaymentView(latest.id, data) : null,
  };
}

module.exports = {
  getDriverSubscriptionSnapshot,
  SNAPSHOT_VERSION,
  RESTORABLE_STATUSES,
};
