// @ts-check
// syncNotificationTokenSecure — stores a real native Android FCM token for the
// authenticated user. userId ALWAYS comes from auth (one user cannot register a
// token for another). Full tokens are never logged — only a short hash.

const admin = require('firebase-admin');
const { createHash } = require('crypto');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateNonEmptyString, validateIdentifier } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const C = require('../rides/constants');

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}}} args
 */
async function syncNotificationToken({ db, request, context, clock }) {
  const uid = request && request.auth && request.auth.uid;
  if (!uid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { internalMessage: 'token sync without authentication' });
  }
  const payload = assertShape(request && request.data, {
    required: ['installationId', 'platform'],
    optional: ['token', 'appVersion', 'role', 'enabled'],
  });
  const installationId = validateIdentifier(payload.installationId, 'installationId');
  if (payload.platform !== 'android') {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: 'only android tokens are supported', safeMetadata: { field: 'platform' } });
  }

  const ref = db.collection(C.NOTIFICATION_TOKENS).doc(`${uid}_${installationId}`);
  const nowMs = clock.now();

  // Logout / disable path.
  if (payload.enabled === false) {
    await ref.set({ active: false, disabledAtMs: nowMs, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    logInfo(context, 'notification.token_synced', { operation: 'token_sync', enabled: false });
    return { active: false };
  }

  const token = validateNonEmptyString(payload.token, 'token');
  await ref.set(
    {
      uid,
      token,
      installationId,
      platform: 'android',
      appVersion: payload.appVersion ? String(payload.appVersion).slice(0, 40) : null,
      role: payload.role ? String(payload.role).slice(0, 20) : null,
      active: true,
      lastSeenAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logInfo(context, 'notification.token_synced', { operation: 'token_sync', enabled: true, tokenHash: tokenHash(token) });
  return { active: true };
}

module.exports = { syncNotificationToken, tokenHash };
