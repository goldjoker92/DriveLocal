// @ts-check
// Secure review of driver profile-photo candidates.
// The original and passenger-ready candidate remain private. Approval copies only
// the sanitized candidate to a versioned publicDriverPhotos path. Replacements
// never remove the currently approved public photo before the new one is approved.

const admin = require('firebase-admin');
const { randomUUID } = require('crypto');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier } = require('../validation/validators');
const { requireAdmin } = require('../auth/adminAuth');
const { writeAuditLog } = require('../audit/auditLog');
const { logInfo, logWarning } = require('../logging/logger');
const C = require('./constants');

const ALLOWED_REJECTION_CODES = new Set([
  'face_covered',
  'too_dark',
  'blurry',
  'multiple_people',
  'screen_or_document',
  'face_too_far',
  'identity_mismatch',
  'other',
]);

function candidatePathsValid(driverId, version, originalPath, publicCandidatePath) {
  const base = `drivers/${driverId}/profile-photo/${version}`;
  return originalPath === `${base}/original.jpg`
    && publicCandidatePath === `${base}/public-candidate.jpg`;
}

function publicPath(driverId, version) {
  return `publicDriverPhotos/${driverId}/${version}.jpg`;
}

function safePhotoView(driverId, data) {
  return {
    driverId,
    driverPhotoReviewStatus: data.driverPhotoReviewStatus || 'missing',
    driverPhotoPublicPath: data.driverPhotoPublicPath || null,
    driverPhotoPublicVersion: data.driverPhotoPublicVersion || null,
    selfieStatus: data.selfieStatus || 'missing',
  };
}

function candidateChangedError(driverId, expectedVersion, actualVersion) {
  return new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
    internalMessage: `photo candidate changed for ${driverId}: expected ${expectedVersion}, got ${actualVersion || 'none'}`,
    safeMetadata: { reason: 'PHOTO_CANDIDATE_CHANGED' },
  });
}

function assertExpectedPendingCandidate(driverId, expectedVersion, data) {
  if (data.driverPhotoCandidateVersion !== expectedVersion) {
    throw candidateChangedError(driverId, expectedVersion, data.driverPhotoCandidateVersion);
  }
  if (data.driverPhotoReviewStatus !== 'pending') {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `photo review status is ${data.driverPhotoReviewStatus}`,
      safeMetadata: { reason: 'PHOTO_NOT_PENDING' },
    });
  }

  const originalPath = String(data.driverPhotoCandidateOriginalPath || '');
  const candidatePath = String(data.driverPhotoCandidatePublicPath || '');
  if (!candidatePathsValid(driverId, expectedVersion, originalPath, candidatePath)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'driver photo candidate paths are invalid',
      safeMetadata: { reason: 'PHOTO_PATH_INVALID' },
    });
  }
  return { originalPath, candidatePath };
}

async function approveDriverPhoto({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data, { required: ['driverId', 'expectedVersion'] });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const expectedVersion = validateIdentifier(payload.expectedVersion, 'expectedVersion');
  const driverRef = db.collection(C.DRIVERS).doc(driverId);

  const initialSnap = await driverRef.get();
  if (!initialSnap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `driver not found: ${driverId}`,
      safeMetadata: { field: 'driverId' },
    });
  }
  const initial = initialSnap.data() || {};

  if (
    initial.driverPhotoReviewStatus === 'approved'
    && initial.driverPhotoPublicVersion === expectedVersion
    && initial.driverPhotoPublicPath === publicPath(driverId, expectedVersion)
  ) {
    return safePhotoView(driverId, initial);
  }

  const { candidatePath } = assertExpectedPendingCandidate(driverId, expectedVersion, initial);
  const nowMs = clock.now();
  const destinationPath = publicPath(driverId, expectedVersion);
  const bucket = admin.storage().bucket();
  const source = bucket.file(candidatePath);
  const destination = bucket.file(destinationPath);
  const [exists] = await source.exists();
  if (!exists) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: `photo candidate missing for driver ${driverId}`,
      safeMetadata: { reason: 'PHOTO_OBJECT_MISSING' },
    });
  }

  logInfo(context, 'driver.photo.approval_started', {
    operation: 'approve_driver_photo',
    driverId,
    version: expectedVersion,
  });

  await source.copy(destination);
  await destination.setMetadata({
    contentType: 'image/jpeg',
    cacheControl: 'private,max-age=3600',
    metadata: {
      firebaseStorageDownloadTokens: randomUUID(),
      approvedVersion: expectedVersion,
      approvedAtMs: String(nowMs),
    },
  });

  let outcome;
  try {
    outcome = await db.runTransaction(async (tx) => {
      const currentSnap = await tx.get(driverRef);
      if (!currentSnap.exists) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
          internalMessage: `driver not found during photo approval: ${driverId}`,
          safeMetadata: { field: 'driverId' },
        });
      }
      const before = currentSnap.data() || {};
      if (
        before.driverPhotoReviewStatus === 'approved'
        && before.driverPhotoPublicVersion === expectedVersion
        && before.driverPhotoPublicPath === destinationPath
      ) {
        return { replay: true, before, after: before };
      }

      assertExpectedPendingCandidate(driverId, expectedVersion, before);
      const update = {
        driverPhotoPublicPath: destinationPath,
        driverPhotoPublicVersion: expectedVersion,
        driverPhotoReviewStatus: 'approved',
        driverPhotoApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
        driverPhotoApprovedAtMs: nowMs,
        driverPhotoApprovedBy: adminUid,
        driverPhotoRejectionCode: null,
        driverPhotoRejectionReason: null,
        selfieStatus: 'approved',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.set(driverRef, update, { merge: true });
      return { replay: false, before, after: { ...before, ...update } };
    });
  } catch (error) {
    await destination.delete({ ignoreNotFound: true }).catch((cleanupError) => {
      logWarning(context, 'driver.photo.orphan_cleanup_failed', {
        operation: 'approve_driver_photo',
        driverId,
        version: expectedVersion,
        internalMessage: cleanupError && cleanupError.message,
      });
    });
    throw error;
  }

  if (!outcome.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'driver_photo_approved',
      targetType: 'driver',
      targetId: driverId,
      traceId: context?.traceId,
      beforeSummary: {
        driverPhotoReviewStatus: outcome.before.driverPhotoReviewStatus || null,
        driverPhotoPublicVersion: outcome.before.driverPhotoPublicVersion || null,
      },
      afterSummary: {
        driverPhotoReviewStatus: 'approved',
        driverPhotoPublicVersion: expectedVersion,
      },
    }, clock);
  }

  logInfo(context, 'driver.photo.approval_succeeded', {
    operation: 'approve_driver_photo',
    driverId,
    version: expectedVersion,
    reasonCode: outcome.replay ? 'IDEMPOTENT_REPLAY' : null,
  });
  return safePhotoView(driverId, outcome.after);
}

async function rejectDriverPhoto({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data, {
    required: ['driverId', 'expectedVersion', 'reasonCode'],
    optional: ['reason'],
  });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const expectedVersion = validateIdentifier(payload.expectedVersion, 'expectedVersion');
  const reasonCode = String(payload.reasonCode || '').trim();
  const reason = payload.reason == null ? '' : String(payload.reason).trim().slice(0, 300);

  if (!ALLOWED_REJECTION_CODES.has(reasonCode)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `invalid photo rejection reason: ${reasonCode}`,
      safeMetadata: { field: 'reasonCode' },
    });
  }

  const driverRef = db.collection(C.DRIVERS).doc(driverId);
  const nowMs = clock.now();
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `driver not found: ${driverId}`,
        safeMetadata: { field: 'driverId' },
      });
    }
    const before = snap.data() || {};

    if (
      before.driverPhotoReviewStatus === 'rejected'
      && before.driverPhotoCandidateVersion === expectedVersion
      && before.driverPhotoRejectionCode === reasonCode
    ) {
      return { replay: true, before, after: before, retainedApprovedPhoto: Boolean(before.driverPhotoPublicPath) };
    }

    assertExpectedPendingCandidate(driverId, expectedVersion, before);
    const hasApprovedPhoto = typeof before.driverPhotoPublicPath === 'string'
      && before.driverPhotoPublicPath.length > 0;
    const initialOnboarding = before.verificationStatus !== 'approved' && !hasApprovedPhoto;
    const update = {
      driverPhotoReviewStatus: 'rejected',
      driverPhotoRejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      driverPhotoRejectedAtMs: nowMs,
      driverPhotoRejectedBy: adminUid,
      driverPhotoRejectionCode: reasonCode,
      driverPhotoRejectionReason: reason || null,
      selfieStatus: hasApprovedPhoto ? 'approved' : 'rejected',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (initialOnboarding) {
      update.verificationStatus = 'correction_requested';
      update.documentsStatus = 'incomplete';
      update.correctionReason = reason || 'A foto de motorista precisa ser refeita.';
      update.correctionRequestedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.set(driverRef, update, { merge: true });
    return {
      replay: false,
      before,
      after: { ...before, ...update },
      retainedApprovedPhoto: hasApprovedPhoto,
    };
  });

  if (!outcome.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'driver_photo_rejected',
      targetType: 'driver',
      targetId: driverId,
      traceId: context?.traceId,
      beforeSummary: {
        driverPhotoReviewStatus: outcome.before.driverPhotoReviewStatus || null,
        driverPhotoCandidateVersion: expectedVersion,
      },
      afterSummary: {
        driverPhotoReviewStatus: 'rejected',
        reasonCode,
        retainedApprovedPhoto: outcome.retainedApprovedPhoto,
      },
    }, clock);
  }

  logWarning(context, 'driver.photo.rejected', {
    operation: 'reject_driver_photo',
    driverId,
    version: expectedVersion,
    reasonCode,
    retainedApprovedPhoto: outcome.retainedApprovedPhoto,
  });
  return safePhotoView(driverId, outcome.after);
}

module.exports = {
  approveDriverPhoto,
  rejectDriverPhoto,
  candidatePathsValid,
  publicPath,
  assertExpectedPendingCandidate,
};
