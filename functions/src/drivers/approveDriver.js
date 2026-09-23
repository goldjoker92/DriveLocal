// @ts-check
// Secure driver approval. One transaction owns the atomic shared approval
// counter and founder assignment. Before approval, a bounded server-side duplicate
// scan checks CPF, plate, Pix, phone and email without logging or returning values.
// A conflict requires explicit admin review/override; it never auto-bans a driver.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateNonEmptyString } = require('../validation/validators');
const { writeAuditLog } = require('../audit/auditLog');
const { logInfo } = require('../logging/logger');
const { requireAdmin } = require('../auth/adminAuth');
const {
  bestEffortRiskSignal,
  caseId: buildCaseId,
  stableId,
} = require('../risk/riskEngine');
const riskC = require('../risk/constants');
const { safeDriverView } = require('./eligibility');
const { scanDriverDuplicates } = require('./duplicateCheck');
const { COMMERCIAL_POLICY_VERSION } = require('./commercialPolicy');
const {
  hasSubmittedCriminalCertificate,
  requiresCriminalCertificate,
} = require('./documentPolicy');
const C = require('./constants');

// The source contains only a one-way fingerprint. A newly matching account changes
// the fingerprint and therefore requires a fresh admin decision instead of reusing
// an old "no evidence" closure forever.
function duplicateConflictSourceId(conflict = {}) {
  const matchingIds = Array.isArray(conflict.matchingDriverIds)
    ? [...new Set(conflict.matchingDriverIds.map(String))].sort()
    : [];
  const fingerprint = stableId([
    String(conflict.field || 'unknown'),
    String(conflict.reasonCode || 'unknown'),
    ...matchingIds,
  ]);
  return `duplicate_${String(conflict.field || 'unknown').slice(0, 20)}_${fingerprint}`;
}

async function reviewedDuplicateOverride(db, driverId, conflicts) {
  if (!Array.isArray(conflicts) || conflicts.length === 0) return null;
  const snapshots = await Promise.all(conflicts.map((conflict) => {
    const id = buildCaseId({
      actorType: riskC.ACTOR_TYPE.DRIVER,
      actorId: driverId,
      reasonCode: conflict.reasonCode,
      sourceType: 'driver_application',
      sourceId: duplicateConflictSourceId(conflict),
    });
    return db.collection(riskC.COLLECTIONS.FRAUD_CASES).doc(id).get();
  }));
  const allClosedWithoutEvidence = snapshots.every((snapshot) =>
    snapshot.exists && (snapshot.data() || {}).status === 'closed_no_evidence'
  );
  return allClosedWithoutEvidence ? 'antifraud_cases_closed_no_evidence' : null;
}

async function approveDriver({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, {
    required: ['driverId'],
    optional: ['duplicateOverrideReason'],
  });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const explicitOverrideReason = payload.duplicateOverrideReason != null
    ? validateNonEmptyString(payload.duplicateOverrideReason, 'duplicateOverrideReason').slice(0, 280)
    : null;
  const driverRef = db.collection(C.DRIVERS).doc(driverId);

  // Fast idempotent replay and duplicate scan happen before the approval
  // transaction. The target is read again transactionally before mutation.
  const initialSnap = await driverRef.get();
  if (!initialSnap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `driver not found: ${driverId}`,
      safeMetadata: { field: 'driverId' },
    });
  }
  const initial = initialSnap.data() || {};
  if (initial.approvalNumber != null
    || (initial.verificationStatus === 'approved' && (initial.approvedAtMs || initial.approvedAt))) {
    logInfo(context, 'driver.approval.duplicate_ignored', {
      operation: 'approve_driver',
      reasonCode: 'ALREADY_APPROVED',
      approvalNumber: initial.approvalNumber,
      founder: initial.founderEligible === true,
      commercialPolicyVersion: initial.commercialPolicyVersion || null,
    });
    return safeDriverView(driverId, initial);
  }

  let duplicateResult;
  try {
    duplicateResult = await scanDriverDuplicates(db, driverId, initial);
  } catch (error) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `duplicate scan unavailable for ${driverId}: ${error?.message}`,
      safeMetadata: { reason: error?.code || 'DUPLICATE_SCAN_FAILED' },
    });
  }

  const conflicts = duplicateResult.conflicts || [];
  const reasonCodes = [...new Set(conflicts.map((conflict) => conflict.reasonCode))];
  const conflictFingerprints = conflicts.map(duplicateConflictSourceId);
  const reviewedOverrideReason = conflicts.length > 0 && !explicitOverrideReason
    ? await reviewedDuplicateOverride(db, driverId, conflicts)
    : null;
  const effectiveOverrideReason = explicitOverrideReason || reviewedOverrideReason;

  if (conflicts.length > 0 && !effectiveOverrideReason) {
    await driverRef.set({
      duplicateCheckStatus: 'review_required',
      duplicateReasonCodes: reasonCodes,
      duplicateConflictFingerprints: conflictFingerprints,
      duplicateConflictCount: conflicts.length,
      duplicateCheckScannedCount: duplicateResult.scannedCount,
      duplicateCheckReviewedAtMs: clock.now(),
      duplicateCheckReviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    for (const conflict of conflicts) {
      const sourceId = duplicateConflictSourceId(conflict);
      await bestEffortRiskSignal({
        db,
        clock,
        context,
        actorType: riskC.ACTOR_TYPE.DRIVER,
        actorId: driverId,
        reasonCode: conflict.reasonCode,
        severity: conflict.hard ? riskC.SEVERITY.HIGH : riskC.SEVERITY.MEDIUM,
        recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
        sourceType: 'driver_application',
        sourceId,
        eventKey: sourceId,
        metadata: {
          count: conflict.matchingDriverIds.length,
          result: 'review_required',
        },
      });
    }

    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `driver duplicate review required for ${driverId}: ${reasonCodes.join(',')}`,
      safeMetadata: {
        reason: 'DUPLICATE_REVIEW_REQUIRED',
        conflictCount: conflicts.length,
        reasonCodes,
      },
    });
  }

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `driver not found: ${driverId}`,
        safeMetadata: { field: 'driverId' },
      });
    }
    const before = snap.data() || {};

    // Idempotent replay: never restart benefits or increment the counter twice.
    if (before.approvalNumber != null
      || (before.verificationStatus === 'approved' && (before.approvedAtMs || before.approvedAt))) {
      return { replay: true, after: before };
    }

    const photoApproved = before.driverPhotoReviewStatus === 'approved'
      && typeof before.driverPhotoPublicPath === 'string'
      && before.driverPhotoPublicPath.startsWith(`publicDriverPhotos/${driverId}/`);
    if (!photoApproved) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `driver photo not approved for ${driverId}`,
        safeMetadata: { reason: 'DRIVER_PHOTO_APPROVAL_REQUIRED' },
      });
    }

    if (!hasSubmittedCriminalCertificate(before, driverId)) {
      logInfo(context, 'driver.approval.criminal_certificate_blocked', {
        operation: 'approve_driver',
        reasonCode: 'CRIMINAL_CERTIFICATE_REQUIRED',
        documentPolicyVersion: before.driverDocumentPolicyVersion || null,
        certificateStatus: before.criminalCertificateStatus || null,
      });
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `driver criminal certificate required for ${driverId}`,
        safeMetadata: { reason: 'CRIMINAL_CERTIFICATE_REQUIRED' },
      });
    }

    validateIdentifier(before.serviceAreaId, 'serviceAreaId');
    const counterRef = db.collection(C.COUNTERS).doc(C.FOUNDER_COUNTER_ID);
    const counterSnap = await tx.get(counterRef);
    const current = counterSnap.exists
      ? Number((counterSnap.data() || {}).approvedCount || 0)
      : 0;
    const approvalNumber = current + 1;
    const isFounder = approvalNumber <= C.FOUNDER_LIMIT;
    const nowMs = clock.now();
    const freePeriodEnd = nowMs + C.FREE_PERIOD_DAYS * C.DAY_MS;

    const duplicateCheckStatus = conflicts.length > 0 ? 'admin_overridden' : 'clear';
    const update = {
      verificationStatus: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedAtMs: nowMs,
      approvalNumber,
      founderEligible: isFounder,
      founderNumber: isFounder ? approvalNumber : null,
      founderGrantedAt: isFounder ? admin.firestore.FieldValue.serverTimestamp() : null,
      // The badge has no expiration; only the commission promotion does.
      commissionFreeUntil: freePeriodEnd,
      commercialPolicyVersion: COMMERCIAL_POLICY_VERSION,
      commercialPolicyAssignedAtMs: nowMs,
      duplicateCheckStatus,
      duplicateReasonCodes: reasonCodes,
      duplicateConflictFingerprints: conflictFingerprints,
      duplicateConflictCount: conflicts.length,
      duplicateCheckScannedCount: duplicateResult.scannedCount,
      duplicateCheckReviewedAtMs: nowMs,
      duplicateCheckReviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      duplicateOverrideReason: conflicts.length > 0 ? effectiveOverrideReason : null,
      duplicateReviewedBy: adminUid,
      reviewedBy: adminUid,
      // Approval grants eligibility only. The driver explicitly starts work later.
      availabilityStatus: 'offline',
      availabilitySessionId: null,
      locationAvailabilitySessionId: null,
      availabilityUpdatedAtMs: nowMs,
      availabilityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (before.walletBalanceCentavos == null) update.walletBalanceCentavos = 0;
    if (before.walletHeldCentavos == null) update.walletHeldCentavos = 0;
    if (before.walletAvailableCentavos == null) update.walletAvailableCentavos = 0;
    if (before.walletLedgerVersion == null) update.walletLedgerVersion = 'v1';
    if (before.isBlocked == null) update.isBlocked = false;
    if (requiresCriminalCertificate(before)) {
      update.criminalCertificateStatus = 'approved';
      update.criminalCertificateReviewedAtMs = nowMs;
      update.criminalCertificateReviewedAt = admin.firestore.FieldValue.serverTimestamp();
      update.criminalCertificateReviewedBy = adminUid;
    }

    tx.set(counterRef, {
      serviceAreaId: C.FOUNDER_COUNTER_ID,
      approvedCount: approvalNumber,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(driverRef, update, { merge: true });

    return {
      replay: false,
      before,
      after: { ...before, ...update, approvedAtMs: nowMs },
    };
  });

  if (!outcome.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'driver_approved',
      targetType: 'driver',
      targetId: driverId,
      reason: conflicts.length > 0 ? 'duplicate_review_override' : null,
      traceId: context && context.traceId,
      beforeSummary: {
        verificationStatus: outcome.before.verificationStatus || null,
        driverPhotoReviewStatus: outcome.before.driverPhotoReviewStatus || null,
        criminalCertificateStatus: outcome.before.criminalCertificateStatus || null,
        driverDocumentPolicyVersion: outcome.before.driverDocumentPolicyVersion || null,
        duplicateConflictCount: conflicts.length,
      },
      afterSummary: {
        verificationStatus: 'approved',
        availabilityStatus: 'offline',
        approvalNumber: outcome.after.approvalNumber,
        founderNumber: outcome.after.founderNumber,
        commercialPolicyVersion: COMMERCIAL_POLICY_VERSION,
        commissionFreeDays: C.FREE_PERIOD_DAYS,
        driverPhotoPublicVersion: outcome.after.driverPhotoPublicVersion || null,
        criminalCertificateStatus: outcome.after.criminalCertificateStatus || null,
        driverDocumentPolicyVersion: outcome.after.driverDocumentPolicyVersion || null,
        duplicateCheckStatus: outcome.after.duplicateCheckStatus,
        duplicateOverrideSource: reviewedOverrideReason
          ? 'closed_risk_cases'
          : explicitOverrideReason
            ? 'explicit_admin_reason'
            : null,
      },
    }, clock);

    logInfo(context, 'driver.commercial_policy_assigned', {
      operation: 'approve_driver',
      policyVersion: COMMERCIAL_POLICY_VERSION,
      approvalNumber: outcome.after.approvalNumber,
      founder: outcome.after.founderEligible === true,
      freePeriodDays: C.FREE_PERIOD_DAYS,
      vehicleType: outcome.after.vehicleType || null,
    });
  }

  return safeDriverView(driverId, outcome.after);
}

module.exports = {
  approveDriver,
  duplicateConflictSourceId,
  reviewedDuplicateOverride,
};
