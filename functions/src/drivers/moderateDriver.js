// @ts-check
// Secure driver moderation: reject, block, unblock. All admin-only, all require
// a human reason, all write a server timestamp and an audit record. None of them
// ever reset approvedAt, founder status, or financial history — moderation is
// additive state on top of the approval record.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateNonEmptyString } = require('../validation/validators');
const { writeAuditLog } = require('../audit/auditLog');
const { requireAdmin } = require('../auth/adminAuth');
const { safeDriverView } = require('./eligibility');
const C = require('./constants');

async function loadDriver(db, driverId) {
  const ref = db.collection(C.DRIVERS).doc(driverId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `driver not found: ${driverId}`,
      safeMetadata: { field: 'driverId' },
    });
  }
  return { ref, before: snap.data() || {} };
}

/**
 * Shared skeleton for the three admin+reason moderation actions.
 * @param {string} action audit action name
 * @param {(reason:string, adminUid:string)=>object} buildUpdate
 */
function makeModerator(action, buildUpdate) {
  return async function moderate({ db, request, context, clock }) {
    const adminUid = await requireAdmin(db, request);
    const payload = assertShape(request && request.data, { required: ['driverId', 'reason'] });
    const driverId = validateIdentifier(payload.driverId, 'driverId');
    const reason = validateNonEmptyString(payload.reason, 'reason');

    const { ref, before } = await loadDriver(db, driverId);
    const update = buildUpdate(reason, adminUid, clock);
    await ref.set(update, { merge: true });

    await writeAuditLog(
      db,
      {
        actorUid: adminUid,
        actorType: 'admin',
        action,
        targetType: 'driver',
        targetId: driverId,
        reason,
        traceId: context && context.traceId,
        beforeSummary: {
          verificationStatus: before.verificationStatus || null,
          isBlocked: before.isBlocked === true,
        },
        afterSummary: { action },
      },
      clock
    );

    return safeDriverView(driverId, { ...before, ...update });
  };
}

// verificationStatus -> rejected; approval/founder/financial history untouched.
const rejectDriver = makeModerator('driver_rejected', (reason, adminUid, clock) => ({
  verificationStatus: 'rejected',
  rejectionReason: reason,
  reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
  reviewedAtMs: clock.now(),
  reviewedBy: adminUid,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}));

// Idempotent: re-blocking simply re-asserts the block with a fresh reason/time.
const blockDriver = makeModerator('driver_blocked', (reason, adminUid, clock) => ({
  isBlocked: true,
  blockReason: reason,
  blockedAt: admin.firestore.FieldValue.serverTimestamp(),
  blockedAtMs: clock.now(),
  blockedBy: adminUid,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}));

// Idempotent: unblocking clears the block flag; approval/founder state persists.
const unblockDriver = makeModerator('driver_unblocked', (reason, adminUid, clock) => ({
  isBlocked: false,
  blockReason: null,
  unblockedAt: admin.firestore.FieldValue.serverTimestamp(),
  unblockedAtMs: clock.now(),
  unblockedBy: adminUid,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}));

module.exports = { rejectDriver, blockDriver, unblockDriver };
