// @ts-check
// DriveLocal Cloud Functions entrypoint (JavaScript, gen 2).

const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const { health } = require('./diagnostics/health');
exports.health = health;

const driverCallables = require('./drivers/callables');
exports.approveDriverSecure = driverCallables.approveDriverSecure;
exports.rejectDriverSecure = driverCallables.rejectDriverSecure;
exports.blockDriverSecure = driverCallables.blockDriverSecure;
exports.unblockDriverSecure = driverCallables.unblockDriverSecure;
exports.activateSubscriptionSecure = driverCallables.activateSubscriptionSecure;
exports.suspendDriverSecure = driverCallables.suspendDriverSecure;
exports.reactivateDriverSecure = driverCallables.reactivateDriverSecure;
exports.approveDriverPhotoSecure = driverCallables.approveDriverPhotoSecure;
exports.rejectDriverPhotoSecure = driverCallables.rejectDriverPhotoSecure;

const paymentCallables = require('./payments/callables');
exports.createDriverPixPayment = paymentCallables.createDriverPixPayment;
exports.getDriverPaymentStatus = paymentCallables.getDriverPaymentStatus;
exports.reprocessDriverPayment = paymentCallables.reprocessDriverPayment;
exports.mercadoPagoWebhook = paymentCallables.mercadoPagoWebhook;

const rideCallables = require('./rides/callables');
exports.createRideRequestSecure = rideCallables.createRideRequestSecure;
exports.acceptDriverOfferSecure = rideCallables.acceptDriverOfferSecure;
exports.declineDriverOfferSecure = rideCallables.declineDriverOfferSecure;
exports.markDriverArrivedSecure = rideCallables.markDriverArrivedSecure;
exports.startRideSecure = rideCallables.startRideSecure;
exports.finishRideSecure = rideCallables.finishRideSecure;
exports.markPassengerPixSentSecure = rideCallables.markPassengerPixSentSecure;
exports.confirmDriverPixReceivedSecure = rideCallables.confirmDriverPixReceivedSecure;
exports.cancelRideSecure = rideCallables.cancelRideSecure;
exports.reportRidePaymentIssueSecure = rideCallables.reportRidePaymentIssueSecure;
exports.resolveRideDisputeSecure = rideCallables.resolveRideDisputeSecure;

const { expireRideOffersTask } = require('./rides/expireOffersTask');
exports.expireRideOffersTask = expireRideOffersTask;

const notificationCallables = require('./notifications/callables');
exports.syncNotificationTokenSecure = notificationCallables.syncNotificationTokenSecure;
exports.processRideNotificationEvent = notificationCallables.processRideNotificationEvent;

const walletCallables = require('./wallet/callables');
exports.adjustDriverWalletSecure = walletCallables.adjustDriverWalletSecure;

// Launch antifraud and business observability. Analytics/case decisions are
// admin-only. Automated scans create review signals or temporary new-ride gates;
// they never change hold amounts, settle commissions or permanently ban accounts.
const riskCallables = require('./risk/callables');
exports.getAdminBusinessAnalyticsSecure = riskCallables.getAdminBusinessAnalyticsSecure;
exports.listAdminRiskCasesSecure = riskCallables.listAdminRiskCasesSecure;
exports.decideAdminRiskCaseSecure = riskCallables.decideAdminRiskCaseSecure;
const { financialReconciliationTask } = require('./risk/reconciliation');
exports.financialReconciliationTask = financialReconciliationTask;
const { operationalRiskScanTask } = require('./risk/operationalScan');
exports.operationalRiskScanTask = operationalRiskScanTask;
const { driverLocationRiskTrigger } = require('./risk/locationRisk');
exports.driverLocationRiskTrigger = driverLocationRiskTrigger;
const { ridePaymentRestrictionTrigger } = require('./risk/paymentRestriction');
exports.ridePaymentRestrictionTrigger = ridePaymentRestrictionTrigger;
const { supplySnapshotTask } = require('./risk/supplySnapshots');
exports.supplySnapshotTask = supplySnapshotTask;
