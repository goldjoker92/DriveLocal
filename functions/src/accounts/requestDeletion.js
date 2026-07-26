// @ts-check
// Authenticated account-deletion request. The callable only accepts passenger and
// driver accounts, requires a recent Firebase authentication, and refuses to start
// while an operational ride or unresolved dispute still belongs to the account.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape } = require('../validation/validators');
const { logInfo, logWarning, shortHash } = require('../logging/logger');
const C = require('../rides/constants');
const {
  POLICY_VERSION,
  ACCOUNT_DELETION_REQUESTS,
  DELETION_BLOCKING_RIDE_STATUSES,
  assertConfirmation,
  recentAuthentication,
  authAgeMs,
  createAnonymousSubjectId,
} = require('./deletionPolicy');

async function loadRoleProfile(db, uid) {
  const [driverSnap, passengerSnap] = await Promise.all([
    db.collection(C.DRIVERS).doc(uid).get(),
    db.collection(C.PASSENGERS).doc(uid).get(),
  ]);
  const roles = [];
  if (driverSnap.exists) roles.push({ role: 'driver', ref: driverSnap.ref, data: driverSnap.data() || {} });
  if (passengerSnap.exists) roles.push({ role: 'passenger', ref: passengerSnap.ref, data: passengerSnap.data() || {} });
  return roles.length === 1 ? roles[0] : null;
}

async function findNonFinalRide(db, role, uid) {
  const field = role === 'driver' ? 'acceptedDriverId' : 'passengerId';
  const snapshot = await db.collection(C.RIDE_REQUESTS).where(field, '==', uid).get();
  return snapshot.docs.find((docSnap) => {
    const status = docSnap.data()?.status;
    return DELETION_BLOCKING_RIDE_STATUSES.includes(status);
  }) || null;
}

function blockedError(reason) {
  return new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
    internalMessage: `account deletion blocked: ${reason}`,
    safeMetadata: { reason },
  });
}

async function requestAccountDeletion({ db, request, context, clock }) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'account deletion requested without authentication',
    });
  }

  const payload = assertShape(request?.data, {
    required: ['confirmation'],
    optional: [],
  });
  if (!assertConfirmation(payload.confirmation)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'account deletion confirmation text mismatch',
      safeMetadata: { field: 'confirmation' },
    });
  }

  const nowMs = Number(clock.now());
  if (!recentAuthentication(request?.auth?.token, nowMs)) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `account deletion requires recent authentication; ageMs=${authAgeMs(request?.auth?.token, nowMs)}`,
      safeMetadata: { reason: 'RECENT_LOGIN_REQUIRED' },
    });
  }

  const profile = await loadRoleProfile(db, uid);
  if (!profile) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: 'account deletion requires exactly one passenger or driver profile',
      safeMetadata: { reason: 'ACCOUNT_PROFILE_AMBIGUOUS' },
    });
  }

  if (profile.data.activeRideId) throw blockedError('ACTIVE_RIDE_PRESENT');
  const activeRide = await findNonFinalRide(db, profile.role, uid);
  if (activeRide) {
    const status = activeRide.data()?.status;
    throw blockedError(status === 'disputed' ? 'OPEN_DISPUTE_PRESENT' : 'ACTIVE_RIDE_PRESENT');
  }

  const previousRequestId = typeof profile.data.accountDeletionRequestId === 'string'
    ? profile.data.accountDeletionRequestId
    : null;
  if (previousRequestId) {
    const previous = await db.collection(ACCOUNT_DELETION_REQUESTS).doc(previousRequestId).get();
    if (previous.exists) {
      logInfo(context, 'account_deletion.request_replayed', {
        requestRef: previousRequestId,
        role: profile.role,
        actorHash: shortHash(uid),
      });
      return { accepted: true, requestRef: previousRequestId, status: previous.data()?.status || 'requested', replay: true };
    }
  }

  const requestRef = db.collection(ACCOUNT_DELETION_REQUESTS).doc();
  const anonymousSubjectId = createAnonymousSubjectId(profile.role);
  const requestedAt = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.create(requestRef, {
    requestId: requestRef.id,
    subjectUid: uid,
    anonymousSubjectId,
    role: profile.role,
    status: 'requested',
    policyVersion: POLICY_VERSION,
    requestedAtMs: nowMs,
    requestedAt,
    processingAttempts: 0,
    updatedAt: requestedAt,
  });

  const profileUpdate = {
    accountDeletionStatus: 'requested',
    accountDeletionRequestId: requestRef.id,
    accountDeletionRequestedAtMs: nowMs,
    accountDeletionRequestedAt: requestedAt,
    updatedAt: requestedAt,
  };
  if (profile.role === 'driver') {
    profileUpdate.availabilityStatus = 'offline';
    profileUpdate.availabilitySessionId = null;
    profileUpdate.availabilityUpdatedAtMs = nowMs;
    profileUpdate.availabilityUpdatedAt = requestedAt;
  }
  batch.set(profile.ref, profileUpdate, { merge: true });
  await batch.commit();

  logWarning(context, 'account_deletion.requested', {
    requestRef: requestRef.id,
    role: profile.role,
    actorHash: shortHash(uid),
    policyVersion: POLICY_VERSION,
  });

  return { accepted: true, requestRef: requestRef.id, status: 'requested', replay: false };
}

module.exports = {
  requestAccountDeletion,
  loadRoleProfile,
  findNonFinalRide,
};
