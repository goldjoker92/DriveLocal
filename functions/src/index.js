// @ts-check
// DriveLocal Cloud Functions entrypoint (JavaScript, gen 2).
//
// Initializes Firebase Admin exactly once, then exports callable functions.
// BLOCK 02 ships only the observability/debugging foundation plus one safe
// diagnostic. No Mercado Pago, wallet, approval, ride, or notification logic.

const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const { health } = require('./diagnostics/health');

exports.health = health;

// BLOCK 03 — secure driver domain (admin-only approval, moderation, and manual
// subscription activation). No Mercado Pago, wallet movement, or ride logic.
const driverCallables = require('./drivers/callables');

exports.approveDriverSecure = driverCallables.approveDriverSecure;
exports.rejectDriverSecure = driverCallables.rejectDriverSecure;
exports.blockDriverSecure = driverCallables.blockDriverSecure;
exports.unblockDriverSecure = driverCallables.unblockDriverSecure;
exports.activateSubscriptionSecure = driverCallables.activateSubscriptionSecure;

// BLOCK 05 + 06 — Mercado Pago Pix payments (driver subscription + wallet
// top-up). Real provider adapter at runtime; secrets bound per function via
// Secret Manager. No ride payments (passengers pay drivers directly by Pix).
const paymentCallables = require('./payments/callables');

exports.createDriverPixPayment = paymentCallables.createDriverPixPayment;
exports.getDriverPaymentStatus = paymentCallables.getDriverPaymentStatus;
exports.reprocessDriverPayment = paymentCallables.reprocessDriverPayment;
exports.mercadoPagoWebhook = paymentCallables.mercadoPagoWebhook;

// BLOCK 07 + 08 — ride request, targeted dispatch, and transactional acceptance
// with commission wallet hold. Reads use secured Firestore listeners (no callable
// read wrappers). No ride completion, FCM, or payment settlement yet.
const rideCallables = require('./rides/callables');

exports.createRideRequestSecure = rideCallables.createRideRequestSecure;
exports.acceptDriverOfferSecure = rideCallables.acceptDriverOfferSecure;

// BLOCK 09 + 10 — ride lifecycle, real FCM notifications, and wallet settlement.
exports.markDriverArrivedSecure = rideCallables.markDriverArrivedSecure;
exports.startRideSecure = rideCallables.startRideSecure;
exports.finishRideSecure = rideCallables.finishRideSecure;
exports.markPassengerPixSentSecure = rideCallables.markPassengerPixSentSecure;
exports.confirmDriverPixReceivedSecure = rideCallables.confirmDriverPixReceivedSecure;
exports.cancelRideSecure = rideCallables.cancelRideSecure;
exports.reportRidePaymentIssueSecure = rideCallables.reportRidePaymentIssueSecure;

const notificationCallables = require('./notifications/callables');

exports.syncNotificationTokenSecure = notificationCallables.syncNotificationTokenSecure;
exports.processRideNotificationEvent = notificationCallables.processRideNotificationEvent;
