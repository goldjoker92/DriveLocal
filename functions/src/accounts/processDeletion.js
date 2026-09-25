// @ts-check
// Idempotent account-deletion processor. Direct PII is deleted; ride and financial
// records required for transaction integrity are minimized and detached from the
// former Firebase Auth uid. Firebase Auth is deleted only after data cleanup.

const admin = require('firebase-admin');
const { logInfo, logWarning, logError, shortHash } = require('../logging/logger');
const C = require('../rides/constants');
const paymentC = require('../payments/constants');
const riskC = require('../risk/constants');
const infraC = require('../config/collections');
const { findNonFinalRide } = require('./requestDeletion');
const {
  POLICY_VERSION,
  ACCOUNT_DELETION_AUDITS,
  buildRideAnonymizationUpdate,
  buildFinancialPseudonymizationUpdate,
} = require('./deletionPolicy');

const CHUNK_SIZE = 200;

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function deleteField() {
  return admin.firestore.FieldValue.delete();
}

function runtimeUpdate(template) {
  const output = {};
  for (const [key, value] of Object.entries(template || {})) {
    output[key] = value === 'SERVER_TIMESTAMP' ? serverTimestamp() : value;
  }
  return output;
}

async function mutateMatches({ db, collectionName, field, value, mutate }) {
  let count = 0;
  // Updating/deleting the queried field removes processed documents from the next
  // result page, so no cursor is needed and retries remain idempotent.
  while (true) {
    const snapshot = await db.collection(collectionName)
      .where(field, '==', value)
      .limit(CHUNK_SIZE)
      .get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const docSnap of snapshot.docs) {
      mutate(batch, docSnap);
      count += 1;
    }
    await batch.commit();
    if (snapshot.size < CHUNK_SIZE) break;
  }
  return count;
}

async function deleteMatches(db, collectionName, field, value) {
  return mutateMatches({
    db,
    collectionName,
    field,
    value,
    mutate: (batch, docSnap) => batch.delete(docSnap.ref),
  });
}

async function pseudonymizeMatches(db, collectionName, field, uid, updateFactory) {
  return mutateMatches({
    db,
    collectionName,
    field,
    value: uid,
    mutate: (batch, docSnap) => batch.update(
      docSnap.ref,
      runtimeUpdate(updateFactory(docSnap.data() || {}))
    ),
  });
}

async function anonymizeRides(db, role, uid, anonymousSubjectId) {
  const field = role === 'driver' ? 'acceptedDriverId' : 'passengerId';
  return pseudonymizeMatches(db, C.RIDE_REQUESTS, field, uid, (ride) =>
    buildRideAnonymizationUpdate({
      role,
      anonymousSubjectId,
      ride,
      deleteField: deleteField(),
    })
  );
}

async function pseudonymizeFinancialRecords(db, uid, anonymousSubjectId) {
  const counts = {};
  for (const collectionName of [
    paymentC.PAYMENT_REQUESTS,
    'subscriptionPayments', // Historical financial records still require privacy processing.
    paymentC.WALLET_TRANSACTIONS,
  ]) {
    counts[collectionName] = await pseudonymizeMatches(
      db,
      collectionName,
      'driverId',
      uid,
      (record) => buildFinancialPseudonymizationUpdate({
        anonymousSubjectId,
        deleteField: deleteField(),
        record,
      })
    );
  }
  return counts;
}

async function pseudonymizeRiskProfile(db, role, uid, anonymousSubjectId) {
  // riskEngine.profileId() is `${actorType}_${actorId}`. The document id itself
  // therefore contains the Firebase uid and must be migrated, not merely updated.
  const oldRef = db.collection(riskC.COLLECTIONS.RISK_PROFILES).doc(`${role}_${uid}`);
  const oldSnapshot = await oldRef.get();
  if (!oldSnapshot.exists) return false;

  const before = oldSnapshot.data() || {};
  const newRef = db.collection(riskC.COLLECTIONS.RISK_PROFILES)
    .doc(`${role}_${anonymousSubjectId}`);
  const batch = db.batch();
  batch.set(newRef, {
    actorType: role,
    actorId: anonymousSubjectId,
    totalSignals: Number(before.totalSignals || 0),
    openSignals: Number(before.openSignals || 0),
    lastReasonCode: before.lastReasonCode || null,
    lastSeverity: before.lastSeverity || null,
    lastSignalAtMs: Number(before.lastSignalAtMs || 0) || null,
    lastSignalAt: before.lastSignalAt || null,
    accountDeleted: true,
    accountDeletionPolicyVersion: POLICY_VERSION,
    accountDeletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.delete(oldRef);
  await batch.commit();
  return true;
}

async function pseudonymizeSecurityRecords(db, role, uid, anonymousSubjectId) {
  const timestamp = serverTimestamp();
  const counts = {};

  // Actual fields are defined by auditLog.js, riskEngine.js and reconciliation.js:
  // audit records use actorUid/targetId; risk events and cases use actorId/sourceId;
  // financial alerts use sourceId. Querying exact equality avoids touching ride ids.
  const specs = [
    [infraC.AUDIT_LOGS, 'actorUid'],
    [infraC.AUDIT_LOGS, 'targetId'],
    [riskC.COLLECTIONS.RISK_EVENTS, 'actorId'],
    [riskC.COLLECTIONS.RISK_EVENTS, 'sourceId'],
    [riskC.COLLECTIONS.FRAUD_CASES, 'actorId'],
    [riskC.COLLECTIONS.FRAUD_CASES, 'sourceId'],
    [riskC.COLLECTIONS.FINANCIAL_ALERTS, 'sourceId'],
  ];

  for (const [collectionName, field] of specs) {
    const key = `${collectionName}.${field}`;
    counts[key] = await pseudonymizeMatches(db, collectionName, field, uid, () => ({
      [field]: anonymousSubjectId,
      accountDeleted: true,
      accountDeletionPolicyVersion: POLICY_VERSION,
      accountDeletedAt: timestamp,
      updatedAt: timestamp,
    }));
  }
  counts.riskProfileMigrated = await pseudonymizeRiskProfile(
    db,
    role,
    uid,
    anonymousSubjectId
  );
  return counts;
}

async function deleteOperationalRecords(db, uid) {
  const counts = {};
  const specs = [
    [C.NOTIFICATION_TOKENS, 'uid'],
    [C.NOTIFICATION_EVENTS, 'recipientUid'],
    [C.DRIVER_OFFERS, 'driverId'],
    [C.ACTIVE_RIDE_LOCATIONS, 'driverId'],
    [infraC.IDEMPOTENCY_OPERATIONS, 'actorUid'],
    ['clientErrorReports', 'actorUid'],
  ];
  for (const [collectionName, field] of specs) {
    counts[collectionName] = (counts[collectionName] || 0)
      + await deleteMatches(db, collectionName, field, uid);
  }
  return counts;
}

async function deleteStorageForSubject(uid) {
  const bucket = admin.storage().bucket();
  const prefixes = [`drivers/${uid}/`, `publicDriverPhotos/${uid}/`];
  let deletedPrefixes = 0;
  for (const prefix of prefixes) {
    try {
      await bucket.deleteFiles({ prefix, force: true });
      deletedPrefixes += 1;
    } catch (error) {
      // A missing prefix is harmless. Other failures must retry before Auth deletion.
      if (Number(error?.code) === 404 || error?.code === 'storage/object-not-found') continue;
      throw error;
    }
  }
  return deletedPrefixes;
}

async function deleteAuthUser(uid) {
  try {
    await admin.auth().deleteUser(uid);
    return 'deleted';
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return 'already_missing';
    throw error;
  }
}

async function processAccountDeletion({ db, requestRef, requestData, context, clock }) {
  const uid = requestData?.subjectUid;
  const role = requestData?.role;
  const anonymousSubjectId = requestData?.anonymousSubjectId;
  if (!uid || !['driver', 'passenger'].includes(role) || !anonymousSubjectId) {
    await requestRef.set({
      status: 'failed',
      failureCode: 'INVALID_REQUEST_DOCUMENT',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { status: 'failed', reason: 'INVALID_REQUEST_DOCUMENT' };
  }

  const actorHash = shortHash(uid);
  const nowMs = Number(clock.now());
  await requestRef.set({
    status: 'processing',
    processingAttempts: admin.firestore.FieldValue.increment(1),
    processingStartedAtMs: nowMs,
    processingStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const activeRide = await findNonFinalRide(db, role, uid);
  if (activeRide) {
    const activeStatus = activeRide.data()?.status;
    const blockReason = activeStatus === 'disputed'
      ? 'OPEN_DISPUTE_PRESENT'
      : 'ACTIVE_RIDE_PRESENT';
    await requestRef.set({
      status: 'blocked',
      failureCode: blockReason,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    const profileCollection = role === 'driver' ? C.DRIVERS : C.PASSENGERS;
    await db.collection(profileCollection).doc(uid).set({
      accountDeletionStatus: 'blocked',
      accountDeletionBlockReason: blockReason,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    logWarning(context, 'account_deletion.processing_blocked', {
      requestRef: requestRef.id,
      role,
      actorHash,
      reason: blockReason,
    });
    return { status: 'blocked', reason: blockReason };
  }

  try {
    logInfo(context, 'account_deletion.processing_started', {
      requestRef: requestRef.id,
      role,
      actorHash,
      policyVersion: POLICY_VERSION,
    });

    const counts = {
      rides: await anonymizeRides(db, role, uid, anonymousSubjectId),
      financial: await pseudonymizeFinancialRecords(db, uid, anonymousSubjectId),
      security: await pseudonymizeSecurityRecords(db, role, uid, anonymousSubjectId),
      operationalDeleted: await deleteOperationalRecords(db, uid),
    };

    // Direct profile/private data is deleted only after dependent records are
    // detached from the Firebase uid. The role-prefixed risk profile was migrated
    // in pseudonymizeSecurityRecords(), so it is not deleted here by a wrong id.
    const profileBatch = db.batch();
    profileBatch.delete(db.collection(C.DRIVERS).doc(uid));
    profileBatch.delete(db.collection(C.PASSENGERS).doc(uid));
    profileBatch.delete(db.collection(C.PRIVATE_DRIVER_DATA).doc(uid));
    await profileBatch.commit();

    counts.storagePrefixes = await deleteStorageForSubject(uid);
    const authStatus = await deleteAuthUser(uid);

    const auditRef = db.collection(ACCOUNT_DELETION_AUDITS).doc(requestRef.id);
    await auditRef.set({
      requestId: requestRef.id,
      anonymousSubjectId,
      role,
      status: 'completed',
      policyVersion: POLICY_VERSION,
      requestedAtMs: Number(requestData.requestedAtMs || 0) || null,
      completedAtMs: Number(clock.now()),
      completedAt: serverTimestamp(),
      authStatus,
      counts,
      retainedRecordClasses: [
        'ride_transaction_minimized',
        'financial_ledger_pseudonymized',
        'security_audit_pseudonymized',
      ],
    });

    // The request document is the only temporary uid -> anonymous-id mapping.
    // Remove it after the durable anonymized audit has been written.
    await requestRef.delete();

    logInfo(context, 'account_deletion.processing_succeeded', {
      requestRef: requestRef.id,
      role,
      actorHash,
      authStatus,
      rideCount: counts.rides,
    });
    return { status: 'completed', authStatus, counts };
  } catch (error) {
    await requestRef.set({
      status: 'failed',
      failureCode: String(error?.code || error?.name || 'PROCESSING_FAILED').slice(0, 80),
      lastFailureAtMs: Number(clock.now()),
      lastFailureAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => undefined);
    logError(context, 'account_deletion.processing_failed', {
      requestRef: requestRef.id,
      role,
      actorHash,
      errorCode: error?.code || error?.name || 'PROCESSING_FAILED',
    });
    throw error;
  }
}

module.exports = {
  processAccountDeletion,
  mutateMatches,
  anonymizeRides,
  pseudonymizeFinancialRecords,
  pseudonymizeRiskProfile,
  pseudonymizeSecurityRecords,
  deleteOperationalRecords,
  runtimeUpdate,
};
