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
const { logInfo, shortHash } = require('../logging/logger');
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

const ts = () => admin.firestore.FieldValue.serverTimestamp();

// Suspend a driver (admin, reason mandatory). Transactional so the active-ride
// guard is atomic. INVARIANT: suspension must never corrupt an in-progress ride —
// if the driver holds an activeRideId we reject with a safe conflict and touch
// nothing (no ride/wallet/hold/history change); the admin retries once the ride
// reaches a terminal state. On success: verificationStatus -> suspended (removes
// ride eligibility server-side), availability cleared, approval/founder/financial
// history preserved. Idempotent: re-suspending an already-suspended driver is a
// no-op replay.
async function suspendDriver({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, { required: ['driverId', 'reason'] });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const reason = validateNonEmptyString(payload.reason, 'reason');
  const driverRef = db.collection(C.DRIVERS).doc(driverId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `driver not found: ${driverId}`, safeMetadata: { field: 'driverId' } });
    const before = snap.data() || {};
    if (before.verificationStatus === 'suspended') return { replay: true, before, after: before };
    if (before.activeRideId) {
      throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS, { internalMessage: `cannot suspend driver ${driverId} with active ride`, safeMetadata: { reason: 'driver_has_active_ride' } });
    }
    const nowMs = clock.now();
    const update = {
      verificationStatus: 'suspended',
      previousVerificationStatus: before.verificationStatus || null,
      suspendedReason: reason,
      suspendedAt: ts(),
      suspendedAtMs: nowMs,
      suspendedBy: adminUid,
      availabilityStatus: 'offline', // clear current availability; eligibility now blocks re-online
      updatedAt: ts(),
    };
    tx.set(driverRef, update, { merge: true });
    return { replay: false, before, after: { ...before, ...update } };
  });

  if (!out.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid, actorType: 'admin', action: 'driver_suspended', targetType: 'driver', targetId: driverId, reason,
      traceId: context && context.traceId,
      beforeSummary: { verificationStatus: out.before.verificationStatus || null },
      afterSummary: { verificationStatus: 'suspended' },
    }, clock);
    logInfo(context, 'driver.suspended', { operation: 'suspend', adminIdHash: shortHash(adminUid), targetUserIdHash: shortHash(driverId), reasonCode: 'suspended', result: 'suspended' });
  }
  return safeDriverView(driverId, out.after);
}

// Reactivate a suspended driver (admin). Idempotent. Restores approved status but
// NEVER sets the driver online and NEVER alters wallet balances; suspension
// history is preserved.
async function reactivateDriver({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, { required: ['driverId'], optional: ['reason'] });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const reason = payload.reason != null ? validateNonEmptyString(payload.reason, 'reason') : null;
  const driverRef = db.collection(C.DRIVERS).doc(driverId);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `driver not found: ${driverId}`, safeMetadata: { field: 'driverId' } });
    const before = snap.data() || {};
    if (before.verificationStatus !== 'suspended') return { replay: true, before, after: before };
    const nowMs = clock.now();
    const update = {
      verificationStatus: 'approved', // eligibility restored; availability stays offline (no auto-online)
      reactivatedAt: ts(),
      reactivatedAtMs: nowMs,
      reactivatedBy: adminUid,
      reactivationReason: reason,
      updatedAt: ts(),
    };
    tx.set(driverRef, update, { merge: true });
    return { replay: false, before, after: { ...before, ...update } };
  });

  if (!out.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid, actorType: 'admin', action: 'driver_reactivated', targetType: 'driver', targetId: driverId, reason: reason || 'reactivation',
      traceId: context && context.traceId,
      beforeSummary: { verificationStatus: 'suspended' },
      afterSummary: { verificationStatus: 'approved' },
    }, clock);
    logInfo(context, 'driver.reactivated', { operation: 'reactivate', adminIdHash: shortHash(adminUid), targetUserIdHash: shortHash(driverId), result: 'reactivated' });
  }
  return safeDriverView(driverId, out.after);
}

module.exports = { rejectDriver, blockDriver, unblockDriver, suspendDriver, reactivateDriver };
