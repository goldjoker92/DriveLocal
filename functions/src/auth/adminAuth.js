// @ts-check
// Server-side admin authorization — the single source of truth for "is this
// caller an admin". Trust is server-backed: it relies ONLY on membership in the
// admins/{uid} collection (client write:false), NEVER on a client-supplied role,
// isAdmin, or custom-claim field. Every sensitive callable must gate on this.

const { AppError, ERROR_CODES } = require('../errors/appError');

const ADMINS_COLLECTION = 'admins';

/**
 * Asserts the caller is an authenticated admin and returns their uid.
 * Throws UNAUTHENTICATED when unauthenticated, ADMIN_REQUIRED when the uid is
 * not a provisioned admin. Never trusts client-provided role data.
 * @param {object} db Firestore instance (Admin SDK or fake)
 * @param {object} request callable request ({ auth: { uid } })
 * @returns {Promise<string>} admin uid
 */
async function requireAdmin(db, request) {
  const uid = request && request.auth && request.auth.uid;
  if (!uid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'admin action attempted without authentication',
    });
  }
  const snap = await db.collection(ADMINS_COLLECTION).doc(uid).get();
  if (!snap || !snap.exists) {
    throw new AppError(ERROR_CODES.ADMIN_REQUIRED, {
      internalMessage: `non-admin uid attempted admin action: ${uid}`,
    });
  }
  return uid;
}

module.exports = { requireAdmin, ADMINS_COLLECTION };
