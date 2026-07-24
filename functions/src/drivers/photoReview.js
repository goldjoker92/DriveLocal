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

async function approveDriverPhoto({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data, { required: ['driverId'] });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const driverRef = db.collection(C.DRIVERS).doc(driverId);
  const snap = await driverRef.get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `driver not found: ${driverId}`,
      safeMetadata: { field: 'driverId' },
    });
  }

  const before = snap.data() || {};
  const version = validateIdentifier(before.driverPhotoCandidateVersion, 'driverPhotoCandidateVersion');
  const originalPath = String(before.driverPhotoCandidateOriginalPath || '');
  const candidatePath = String(before.driverPhotoCandidatePublicPath || '');

  if (before.driverPhotoReviewStatus !== 'pending') {
    if (
      before.driverPhotoReviewStatus === 'approved'
      && before.driverPhotoPublicVersion === version
      && before.driverPhotoPublicPath
    ) {
      return safePhotoView(driverId, before);
    }
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `photo review status is ${before.driverPhotoReviewStatus}`,
      safeMetadata: { reason: 'PHOTO_NOT_PENDING' },
    });
  }

  if (!candidatePathsValid(driverId, version, originalPath, candidatePath)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'driver photo candidate paths are invalid',
      safeMetadata: { reason: 'PHOTO_PATH_INVALID' },
    });
  }

  const nowMs = clock.now();
  const destinationPath = publicPath(driverId, version);
  const bucket = admin.storage().bucket();
  const source = bucket.file(candidatePath);
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
    version,
  });

  const downloadToken = randomUUID();
  await source.copy(bucket.file(destinationPath));
  await bucket.file(destinationPath).setMetadata({
    contentType: 'image/jpeg',
    cacheControl: 'private,max-age=3600',
    metadata: {
      firebaseStorageDownloadTokens: downloadToken,
      approvedVersion: version,
      approvedAtMs: String(nowMs),
    },
  });

  const update = {
    driverPhotoPublicPath: destinationPath,
    driverPhotoPublicVersion: version,
    driverPhotoReviewStatus: 'approved',
    driverPhotoApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
    driverPhotoApprovedAtMs: nowMs,
    driverPhotoApprovedBy: adminUid,
    driverPhotoRejectionCode: null,
    driverPhotoRejectionReason: null,
    selfieStatus: 'approved',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await driverRef.set(update, { merge: true });

  await writeAuditLog(
    db,
    {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'driver_photo_approved',
      targetType: 'driver',
      targetId: driverId,
      traceId: context?.traceId,
      beforeSummary: {
        driverPhotoReviewStatus: before.driverPhotoReviewStatus || null,
        driverPhotoPublicVersion: before.driverPhotoPublicVersion || null,
      },
      afterSummary: {
        driverPhotoReviewStatus: 'approved',
        driverPhotoPublicVersion: version,
      },
    },
    clock
  );

  logInfo(context, 'driver.photo.approval_succeeded', {
    operation: 'approve_driver_photo',
    driverId,
    version,
  });
  return safePhotoView(driverId, { ...before, ...update });
}

async function rejectDriverPhoto({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data, { required: ['driverId', 'reasonCode'] });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const reasonCode = String(payload.reasonCode || '').trim();
  const reason = payload.reason == null ? '' : String(payload.reason).trim().slice(0, 300);

  if (!ALLOWED_REJECTION_CODES.has(reasonCode)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `invalid photo rejection reason: ${reasonCode}`,
      safeMetadata: { field: 'reasonCode' },
    });
  }

  const driverRef = db.collection(C.DRIVERS).doc(driverId);
  const snap = await driverRef.get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `driver not found: ${driverId}`,
      safeMetadata: { field: 'driverId' },
    });
  }
  const before = snap.data() || {};
  if (before.driverPhotoReviewStatus !== 'pending') {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `photo review status is ${before.driverPhotoReviewStatus}`,
      safeMetadata: { reason: 'PHOTO_NOT_PENDING' },
    });
  }

  const hasApprovedPhoto = typeof before.driverPhotoPublicPath === 'string'
    && before.driverPhotoPublicPath.length > 0;
  const initialOnboarding = before.verificationStatus !== 'approved' && !hasApprovedPhoto;
  const nowMs = clock.now();
  const update = {
    driverPhotoReviewStatus: 'rejected',
    driverPhotoRejectedAt: admin.firestore.FieldValue.serverTimestamp(),
    driverPhotoRejectedAtMs: nowMs,
    driverPhotoRejectedBy: adminUid,
    driverPhotoRejectionCode: reasonCode,
    driverPhotoRejectionReason: reason || null,
    // Existing approved drivers keep their public image and approved document
    // package. Initial onboarding must return to correction before approval.
    selfieStatus: hasApprovedPhoto ? 'approved' : 'rejected',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (initialOnboarding) {
    update.verificationStatus = 'correction_requested';
    update.documentsStatus = 'incomplete';
    update.correctionReason = reason || 'A foto de motorista precisa ser refeita.';
    update.correctionRequestedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await driverRef.set(update, { merge: true });
  await writeAuditLog(
    db,
    {
      actorUid: adminUid,
      actorType: 'admin',
      action: 'driver_photo_rejected',
      targetType: 'driver',
      targetId: driverId,
      traceId: context?.traceId,
      beforeSummary: { driverPhotoReviewStatus: before.driverPhotoReviewStatus || null },
      afterSummary: {
        driverPhotoReviewStatus: 'rejected',
        reasonCode,
        retainedApprovedPhoto: hasApprovedPhoto,
      },
    },
    clock
  );

  logWarning(context, 'driver.photo.rejected', {
    operation: 'reject_driver_photo',
    driverId,
    version: before.driverPhotoCandidateVersion || null,
    reasonCode,
    retainedApprovedPhoto: hasApprovedPhoto,
  });
  return safePhotoView(driverId, { ...before, ...update });
}

module.exports = {
  approveDriverPhoto,
  rejectDriverPhoto,
  candidatePathsValid,
  publicPath,
};
