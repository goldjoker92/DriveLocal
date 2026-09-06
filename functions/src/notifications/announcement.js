// @ts-check
// Admin announcement to drivers — the persistent counterpart of the push
// broadcast.
//
// A push is a single shot: a driver who swipes it, whose phone reboots, or who
// muted notifications never sees it, and there is no way to know who read it.
// An announcement lives in Firestore, so every driver opening the app sees it
// until he acknowledges it. That makes it the reliable channel for anything the
// fleet must actually know.
//
// One document by design (driverAnnouncements/current): the message is the same
// for everyone, so a driver reads one shared document per session instead of
// the platform writing one row per driver. Acknowledgement stays on the device:
// dismissing a banner is not worth a Firestore write per driver, and the
// announcementId already guarantees a NEW message reappears for everyone.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { requireAdmin } = require('../auth/adminAuth');
const { assertShape } = require('../validation/validators');
const { logInfo } = require('../logging/logger');

const DRIVER_ANNOUNCEMENTS = 'driverAnnouncements';
const CURRENT_ANNOUNCEMENT_ID = 'current';
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 400;

const TONES = Object.freeze(['info', 'warning', 'critical']);

/**
 * Admin-authored copy still crosses a trust boundary into every driver's app:
 * bounded, single-paragraph, no control characters.
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 * @param {boolean} [required]
 * @returns {string}
 */
function validateAnnouncementText(value, field, maxLength, required = true) {
  // The body is a real message and may need paragraphs; a title is one line.
  // Every other control character is stripped either way.
  const allowNewlines = field === 'body';
  const text = typeof value === 'string'
    ? value
      .replace(allowNewlines ? /[\u0000-\u0009\u000B-\u001F\u007F]+/g : /[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    : '';
  if (text.length === 0) {
    if (!required) return '';
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `${field} is required`,
      safeMetadata: { field },
    });
  }
  if (text.length > maxLength) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `${field} exceeds ${maxLength} characters`,
      safeMetadata: { field, maxLength },
    });
  }
  return text;
}

function validateTone(value) {
  if (value == null || value === '') return 'info';
  if (!TONES.includes(value)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `unknown announcement tone: ${value}`,
      safeMetadata: { field: 'tone', allowed: TONES },
    });
  }
  return value;
}

/**
 * Publishes (or replaces) the single live announcement.
 *
 * A new announcementId is generated on every publish, so a driver who dismissed
 * the previous message sees this one: acknowledgement is per message, never
 * "this driver has stopped listening".
 *
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}}} args
 */
async function publishDriverAnnouncement({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, { required: ['title', 'body'] });

  const title = validateAnnouncementText(payload.title, 'title', MAX_TITLE_LENGTH);
  const body = validateAnnouncementText(payload.body, 'body', MAX_BODY_LENGTH);
  const tone = validateTone(payload.tone);
  const nowMs = clock.now();
  const announcementId = `ann_${nowMs.toString(36)}`;

  await db.collection(DRIVER_ANNOUNCEMENTS).doc(CURRENT_ANNOUNCEMENT_ID).set({
    announcementId,
    title,
    body,
    tone,
    active: true,
    publishedAtMs: nowMs,
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    publishedByAdminUid: adminUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logInfo(context, 'driver.announcement.published', {
    operation: 'publish_driver_announcement',
    announcementId,
    tone,
  });

  return { announcementId, title, body, tone, active: true, publishedAtMs: nowMs };
}

/**
 * Takes the live announcement down. Keeps the document (and its id) so the
 * client can distinguish "nothing to show" from "never loaded".
 *
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}}} args
 */
async function clearDriverAnnouncement({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const ref = db.collection(DRIVER_ANNOUNCEMENTS).doc(CURRENT_ANNOUNCEMENT_ID);

  await ref.set(
    {
      active: false,
      clearedAtMs: clock.now(),
      clearedByAdminUid: adminUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logInfo(context, 'driver.announcement.cleared', {
    operation: 'clear_driver_announcement',
  });

  return { active: false };
}

module.exports = {
  publishDriverAnnouncement,
  clearDriverAnnouncement,
  validateAnnouncementText,
  validateTone,
  DRIVER_ANNOUNCEMENTS,
  CURRENT_ANNOUNCEMENT_ID,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  TONES,
};
