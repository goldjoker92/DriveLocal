// @ts-check
// DriveLocal Cloud Functions entrypoint (JavaScript, gen 2).

const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const { health } = require('./diagnostics/health');
exports.health = health;

const clientErrorCallables = require('./clientErrors/callables');
exports.reportClientErrorSecure = clientErrorCallables.reportClientErrorSecure;

const accountCallables = require('./accounts/callables');
exports.requestAccountDeletionSecure = accountCallables.requestAccountDeletionSecure;
exports.processAccountDeletionRequest = accountCallables.processAccountDeletionRequest;
const {
  passengerPublicPhotoCleanupTrigger,
} = require('./accounts/passengerPhotoCleanup');
exports.passengerPublicPhotoCleanupTrigger = passengerPublicPhotoCleanupTrigger;

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
exports.setDriverAvailabilitySecure = driverCallables.setDriverAvailabilitySecure;
exports.getDriverRideHistorySecure = driverCallables.getDriverRideHistorySecure;
const { driverCockpitStatsTrigger } = require('./drivers/cockpitStatsTrigger');
exports.driverCockpitStatsTrigger = driverCockpitStatsTrigger;
const {
  driverOfferReceivedStatsTrigger,
  driverOfferAcceptedStatsTrigger,
  driverTerminalRideStatsTrigger,
} = require('./drivers/performanceStatsTriggers');
exports.driverOfferReceivedStatsTrigger = driverOfferReceivedStatsTrigger;
exports.driverOfferAcceptedStatsTrigger = driverOfferAcceptedStatsTrigger;
exports.driverTerminalRideStatsTrigger = driverTerminalRideStatsTrigger;

const paymentCallables = require('./payments/callables');
exports.createDriverPixPayment = paymentCallables.createDriverPixPayment;
exports.getDriverPaymentStatus = paymentCallables.getDriverPaymentStatus;
exports.getDriverSubscriptionSnapshot = paymentCallables.getDriverSubscriptionSnapshot;
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
exports.sendRideQuickMessageSecure = rideCallables.sendRideQuickMessageSecure;
exports.reportRidePaymentIssueSecure = rideCallables.reportRidePaymentIssueSecure;
exports.resolveRideDisputeSecure = rideCallables.resolveRideDisputeSecure;
exports.getAdminRideSummarySecure = rideCallables.getAdminRideSummarySecure;
exports.listAdminDisputedRidesSecure = rideCallables.listAdminDisputedRidesSecure;

const { expireRideOffersTask } = require('./rides/expireOffersTask');
exports.expireRideOffersTask = expireRideOffersTask;
const {
  cancellationNotificationStatusTrigger,
} = require('./rides/cancellationNotificationStatus');
exports.cancellationNotificationStatusTrigger = cancellationNotificationStatusTrigger;
const {
  acceptedPassengerIdentityTrigger,
} = require('./rides/passengerIdentityProjection');
exports.acceptedPassengerIdentityTrigger = acceptedPassengerIdentityTrigger;

const notificationCallables = require('./notifications/callables');
exports.syncNotificationTokenSecure = notificationCallables.syncNotificationTokenSecure;
exports.processRideNotificationEvent = notificationCallables.processRideNotificationEvent;

const supportCallables = require('./support/callables');
exports.createSupportTicketSecure = supportCallables.createSupportTicketSecure;
exports.listMySupportTicketsSecure = supportCallables.listMySupportTicketsSecure;
exports.listAdminSupportTicketsSecure = supportCallables.listAdminSupportTicketsSecure;
exports.updateAdminSupportTicketSecure = supportCallables.updateAdminSupportTicketSecure;
exports.pseudonymizeSupportTicketsOnAccountDeletion =
  supportCallables.pseudonymizeSupportTicketsOnAccountDeletion;

const adminAlertCallables = require('./adminAlerts/callables');
exports.listAdminAlertsSecure = adminAlertCallables.listAdminAlertsSecure;
exports.updateAdminAlertSecure = adminAlertCallables.updateAdminAlertSecure;
exports.supportTicketAdminAlertTrigger = adminAlertCallables.supportTicketAdminAlertTrigger;
exports.rideDisputeAdminAlertTrigger = adminAlertCallables.rideDisputeAdminAlertTrigger;
exports.paymentReviewAdminAlertTrigger = adminAlertCallables.paymentReviewAdminAlertTrigger;
exports.riskCaseAdminAlertTrigger = adminAlertCallables.riskCaseAdminAlertTrigger;
exports.accountDeletionAdminAlertTrigger = adminAlertCallables.accountDeletionAdminAlertTrigger;
exports.clientErrorAdminAlertTrigger = adminAlertCallables.clientErrorAdminAlertTrigger;

const walletCallables = require('./wallet/callables');
exports.adjustDriverWalletSecure = walletCallables.adjustDriverWalletSecure;
exports.getDriverWalletSnapshot = walletCallables.getDriverWalletSnapshot;

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
