// @ts-check
// Independent idempotent cleanup for support tickets. It listens to the same
// deletion request as the main account processor so support data never keeps the
// former Firebase uid, even though tickets are stored in a separate domain.

const admin = require('firebase-admin');
const { logInfo, logWarning, shortHash } = require('../logging/logger');
const { SUPPORT_TICKETS } = require('./policy');

const CHUNK_SIZE = 200;

async function pseudonymizeSupportTickets({ db, requestData, context }) {
  const uid = requestData?.subjectUid;
  const anonymousSubjectId = requestData?.anonymousSubjectId;
  const role = requestData?.role;
  if (!uid || !anonymousSubjectId || !['driver', 'passenger'].includes(role)) {
    logWarning(context, 'support.account_deletion_skipped', {
      operation: 'pseudonymize_support_tickets',
      reason: 'invalid_request_document',
    });
    return { status: 'skipped', count: 0 };
  }

  let count = 0;
  while (true) {
    const snapshot = await db.collection(SUPPORT_TICKETS)
      .where('actorUid', '==', uid)
      .limit(CHUNK_SIZE)
      .get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const ticketSnap of snapshot.docs) {
      batch.set(ticketSnap.ref, {
        actorUid: anonymousSubjectId,
        actorHash: shortHash(anonymousSubjectId),
        issueFingerprint: admin.firestore.FieldValue.delete(),
        accountDeleted: true,
        accountDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      count += 1;
    }
    await batch.commit();
    if (snapshot.size < CHUNK_SIZE) break;
  }

  logInfo(context, 'support.account_deletion_completed', {
    operation: 'pseudonymize_support_tickets',
    actorRole: role,
    ticketCount: count,
  });
  return { status: 'completed', count };
}

module.exports = { pseudonymizeSupportTickets, CHUNK_SIZE };