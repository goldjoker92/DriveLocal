// @ts-check
// Admin-only ride reads. The mobile admin receives only fields required for support,
// finance and antifraud decisions. Exact coordinates, address labels, Pix payloads,
// contact details and private documents never cross this callable boundary.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier } = require('../validation/validators');
const { requireAdmin } = require('../auth/adminAuth');
const { logInfo, shortHash } = require('../logging/logger');
const C = require('./constants');

const MAX_DISPUTED_RIDES = 100;

function numberOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safePolicy(value = {}) {
  return {
    policyVersion: typeof value.policyVersion === 'string' ? value.policyVersion.slice(0, 80) : null,
    pricingConfigVersion: typeof value.pricingConfigVersion === 'string'
      ? value.pricingConfigVersion.slice(0, 80)
      : null,
    estimatedCommissionCentavos: numberOrNull(value.estimatedCommissionCentavos),
    holdAmountCentavos: numberOrNull(value.holdAmountCentavos),
    commissionFreeAtAcceptance: value.commissionFreeAtAcceptance === true,
    acceptedAtMs: numberOrNull(value.acceptedAtMs),
  };
}

function safeDisputeResolution(value = null) {
  if (!value || typeof value !== 'object') return null;
  return {
    outcome: typeof value.outcome === 'string' ? value.outcome.slice(0, 80) : null,
    reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode.slice(0, 120) : null,
    // Admin-authored note only. Passenger/driver free text is not copied here.
    note: typeof value.note === 'string' ? value.note.slice(0, 280) : null,
    resolvedAtMs: numberOrNull(value.resolvedAtMs),
  };
}

function safeAdminRideView(rideId, ride = {}) {
  return {
    rideId,
    status: typeof ride.status === 'string' ? ride.status : null,
    serviceAreaId: typeof ride.serviceAreaId === 'string' ? ride.serviceAreaId : null,
    vehicleType: ride.vehicleType === 'moto' ? 'moto' : 'car',
    passengerId: typeof ride.passengerId === 'string' ? ride.passengerId : null,
    acceptedDriverId: typeof ride.acceptedDriverId === 'string' ? ride.acceptedDriverId : null,
    estimatedFareCentavos: numberOrNull(ride.estimatedFareCentavos),
    finalFareCentavos: numberOrNull(ride.finalFareCentavos),
    estimatedCommissionCentavos: numberOrNull(ride.estimatedCommissionCentavos),
    finalCommissionCentavos: numberOrNull(ride.finalCommissionCentavos),
    commissionHoldCentavos: numberOrNull(ride.commissionHoldCentavos),
    commissionOriginalHoldCentavos: numberOrNull(ride.commissionOriginalHoldCentavos),
    commissionCapturedCentavos: numberOrNull(ride.commissionCapturedCentavos),
    holdReleasedCentavos: numberOrNull(ride.holdReleasedCentavos),
    commissionSettlementStatus: typeof ride.commissionSettlementStatus === 'string'
      ? ride.commissionSettlementStatus
      : null,
    commissionPolicySnapshot: safePolicy(ride.commissionPolicySnapshot || {}),
    createdAtMs: numberOrNull(ride.createdAtMs),
    acceptedAtMs: numberOrNull(ride.acceptedAtMs),
    driverArrivedAtMs: numberOrNull(ride.driverArrivedAtMs),
    startedAtMs: numberOrNull(ride.startedAtMs),
    awaitingPaymentAtMs: numberOrNull(ride.awaitingPaymentAtMs),
    passengerMarkedPaidAtMs: numberOrNull(ride.passengerMarkedPaidAtMs),
    completedAtMs: numberOrNull(ride.completedAtMs),
    cancelledAtMs: numberOrNull(ride.cancelledAtMs),
    disputedAtMs: numberOrNull(ride.disputedAtMs),
    cancelledBy: typeof ride.cancelledBy === 'string' ? ride.cancelledBy : null,
    cancelReasonCode: typeof ride.cancelReasonCode === 'string' ? ride.cancelReasonCode.slice(0, 80) : null,
    disputedBy: typeof ride.disputedBy === 'string' ? ride.disputedBy : null,
    disputeReasonCode: typeof ride.disputeReasonCode === 'string' ? ride.disputeReasonCode.slice(0, 80) : null,
    disputeResolutionStatus: typeof ride.disputeResolutionStatus === 'string'
      ? ride.disputeResolutionStatus
      : null,
    disputeResolution: safeDisputeResolution(ride.disputeResolution),
    requiresManualReview: ride.requiresManualReview === true,
  };
}

async function getAdminRideSummary({ db, request, context }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data || {}, { required: ['rideId'] });
  const rideId = validateIdentifier(payload.rideId, 'rideId');
  const snapshot = await db.collection(C.RIDE_REQUESTS).doc(rideId).get();
  if (!snapshot.exists) return null;

  logInfo(context, 'admin.ride_summary.read', {
    operation: 'admin_ride_summary',
    adminIdHash: shortHash(adminUid),
    rideId,
    result: 'found',
  });
  return safeAdminRideView(rideId, snapshot.data() || {});
}

async function listAdminDisputedRides({ db, request, context }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data || {}, { optional: ['limit'] });
  const requestedLimit = payload.limit == null ? 50 : Number(payload.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_DISPUTED_RIDES) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `invalid disputed ride limit: ${payload.limit}`,
      safeMetadata: { field: 'limit' },
    });
  }

  const snapshot = await db.collection(C.RIDE_REQUESTS)
    .where('status', '==', C.RIDE_STATUS.DISPUTED)
    .orderBy('updatedAt', 'desc')
    .limit(requestedLimit)
    .get();
  const rides = snapshot.docs.map((document) =>
    safeAdminRideView(document.id, document.data() || {})
  );

  logInfo(context, 'admin.disputed_rides.listed', {
    operation: 'admin_disputed_rides',
    adminIdHash: shortHash(adminUid),
    result: 'listed',
    count: rides.length,
  });
  return { rides, truncated: snapshot.size >= requestedLimit };
}

module.exports = {
  MAX_DISPUTED_RIDES,
  safeAdminRideView,
  getAdminRideSummary,
  listAdminDisputedRides,
};
