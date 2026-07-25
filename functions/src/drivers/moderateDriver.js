// @ts-check
// Secure driver moderation: reject, block, unblock, suspend and reactivate. All
// admin-only actions are auditable. Revocation affects new work sessions/offers;
// an already assigned ride keeps its dedicated activeRideLocations channel.

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

const ts = () => admin.firestore.FieldValue.serverTimestamp();

function revokeWorkSession(clock) {
  const nowMs = Number(clock.now());
  return {
    availabilityStatus: 'offline',
    availabilitySessionId: null,
    locationAvailabilitySessionId: null,
    availabilityUpdatedAtMs: nowMs,
    availabilityUpdatedAt: ts(),
    availabilitySessionEndedAtMs: nowMs,
    availabilitySessionEndedAt: ts(),
  };
}

/**
 * Shared skeleton for the admin+reason moderation actions.
 * @param {string} action audit action name
 * @param {(reason:string, adminUid:string, clock:object)=>object} buildUpdate
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
          availabilityStatus: before.availabilityStatus || null,
        },
        afterSummary: {
          action,
          availabilityStatus: update.availabilityStatus || before.availabilityStatus || null,
        },
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
  reviewedAt: ts(),
  reviewedAtMs: clock.now(),
  reviewedBy: adminUid,
  ...revokeWorkSession(clock),
  updatedAt: ts(),
}));

// Idempotent: re-blocking re-asserts the block and revokes any work session.
const blockDriver = makeModerator('driver_blocked', (reason, adminUid, clock) => ({
  isBlocked: true,
  blockReason: reason,
  blockedAt: ts(),
  blockedAtMs: clock.now(),
  blockedBy: adminUid,
  ...revokeWorkSession(clock),
  updatedAt: ts(),
}));

// Idempotent: unblocking clears the block flag; it never makes the driver online.
const unblockDriver = makeModerator('driver_unblocked', (reason, adminUid, clock) => ({
  isBlocked: false,
  blockReason: null,
  unblockedAt: ts(),
  unblockedAtMs: clock.now(),
  unblockedBy: adminUid,
  updatedAt: ts(),
}));

// Suspend a driver (admin, reason mandatory). Transactional so the active-ride
// guard is atomic. Existing product policy requires the admin to wait for a ride
// to finish before suspension. On success the work session is revoked.
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
      ...revokeWorkSession(clock),
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
      afterSummary: { verificationStatus: 'suspended', availabilityStatus: 'offline' },
    }, clock);
    logInfo(context, 'driver.suspended', { operation: 'suspend', adminIdHash: shortHash(adminUid), targetUserIdHash: shortHash(driverId), reasonCode: 'suspended', result: 'suspended' });
  }
  return safeDriverView(driverId, out.after);
}

// Reactivate a suspended driver. Approval is restored but availability remains
// offline and requires a fresh explicit “Começar a trabalhar” action.
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
      verificationStatus: 'approved',
      availabilityStatus: 'offline',
      availabilitySessionId: null,
      locationAvailabilitySessionId: null,
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
      afterSummary: { verificationStatus: 'approved', availabilityStatus: 'offline' },
    }, clock);
    logInfo(context, 'driver.reactivated', { operation: 'reactivate', adminIdHash: shortHash(adminUid), targetUserIdHash: shortHash(driverId), result: 'reactivated' });
  }
  return safeDriverView(driverId, out.after);
}

module.exports = {
  rejectDriver,
  blockDriver,
  unblockDriver,
  suspendDriver,
  reactivateDriver,
  revokeWorkSession,
};
