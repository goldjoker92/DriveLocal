// @ts-check
// Admin broadcasts to drivers and passengers, with separate server-owned
// recipient collections, campaign records, cooldowns and notification events.
//
// The passenger update broadcast uses the notification pipeline already in
// installed apps. A push can be missed when notifications are disabled; it is
// an earlier heads-up, not a substitute for the server quote requirement.
//
// Deliberate limits:
//   - the STATUS channel, never the ride-offer channel. The offer sound and its
//     max-priority banner are what earns money; spending them on operational
//     messages devalues the only alert that must always cut through;
//   - one campaign per hour PER audience. Over-messaging risks users muting the
//     app and losing ride updates;
//   - /driver-home and /passenger-home already exist in shipped route allowlists.
//
// Sending is fire-and-forget by design: this creates notificationEvents and the
// existing onCreate trigger delivers them, retries them and disables dead tokens.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { requireAdmin } = require('../auth/adminAuth');
const { assertShape } = require('../validation/validators');
const { logInfo, logWarning } = require('../logging/logger');
const { buildNotificationEvent } = require('./events');
const C = require('../rides/constants');

const BROADCAST_CAMPAIGNS = 'driverBroadcastCampaigns';
const PASSENGER_BROADCAST_CAMPAIGNS = 'passengerBroadcastCampaigns';
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const MAX_TITLE_LENGTH = 60;
const MAX_BODY_LENGTH = 160;
// One Firestore batch holds 500 operations. Well above the fleet size, but the
// write loop chunks anyway so a future fleet cannot silently truncate.
const BATCH_LIMIT = 400;

/**
 * Campaign ids become part of deterministic event ids, so they must be safe as
 * a document id and stable: re-running the same campaign re-uses the same ids
 * and the onCreate trigger stays silent instead of notifying twice.
 * @param {unknown} value
 * @returns {string}
 */
function validateCampaignId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(text)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'campaignId must be 4-64 chars of [A-Za-z0-9_-]',
      safeMetadata: { field: 'campaignId' },
    });
  }
  return text;
}

/**
 * Visible text is admin-authored, never user input, but it still crosses into a
 * push payload: single line, bounded, no control characters.
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {string}
 */
function validateMessageText(value, field, maxLength) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length === 0 || text.length > maxLength) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `${field} must be 1-${maxLength} characters`,
      safeMetadata: { field, maxLength },
    });
  }
  return text;
}

/**
 * A driver is a valid recipient when the account is usable today. Commercial
 * and wallet state are NOT checked: a driver who cannot currently take rides
 * still needs to hear that a new version exists.
 * @param {object} d driver document data
 */
function isBroadcastRecipient(d = {}) {
  return d.verificationStatus === 'approved'
    && d.isBlocked !== true
    && !['requested', 'processing'].includes(d.accountDeletionStatus);
}

function isPassengerBroadcastRecipient(p = {}) {
  return (p.role == null || p.role === 'passenger')
    && p.isBlocked !== true
    && !['requested', 'processing', 'blocked'].includes(p.accountDeletionStatus);
}

const AUDIENCES = Object.freeze({
  driver: {
    campaigns: BROADCAST_CAMPAIGNS,
    profiles: C.DRIVERS,
    eventType: C.NOTIFICATION_EVENT.DRIVER_BROADCAST,
    route: '/driver-home',
    eligible: isBroadcastRecipient,
  },
  passenger: {
    campaigns: PASSENGER_BROADCAST_CAMPAIGNS,
    profiles: C.PASSENGERS,
    eventType: C.NOTIFICATION_EVENT.PASSENGER_BROADCAST,
    route: '/passenger-home',
    eligible: isPassengerBroadcastRecipient,
  },
});

/**
 * Rejects a campaign sent too soon after the previous one. Read before any
 * write, so a rejected call leaves nothing behind.
 * @param {{db:object, nowMs:number, campaigns:string}} args
 */
async function assertSendingAllowed({ db, nowMs, campaigns }) {
  const snap = await db
    .collection(campaigns)
    .orderBy('createdAtMs', 'desc')
    .limit(1)
    .get();

  let last = null;
  snap.forEach((doc) => { last = doc.data() || {}; });
  const lastAtMs = Number(last?.createdAtMs || 0);
  if (lastAtMs > 0 && nowMs - lastAtMs < MIN_INTERVAL_MS) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: `broadcast rate limit: last campaign ${nowMs - lastAtMs}ms ago`,
      safeMetadata: {
        reason: 'BROADCAST_RATE_LIMITED',
        retryAfterMs: MIN_INTERVAL_MS - (nowMs - lastAtMs),
      },
    });
  }
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}, audience:'driver'|'passenger'}} args
 * @returns {Promise<{campaignId:string, recipientCount:number, skippedCount:number}>}
 */
async function sendAudienceBroadcast({ db, request, context, clock, audience }) {
  const config = AUDIENCES[audience];
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, {
    required: ['campaignId', 'title', 'body'],
  });

  const campaignId = validateCampaignId(payload.campaignId);
  const title = validateMessageText(payload.title, 'title', MAX_TITLE_LENGTH);
  const body = validateMessageText(payload.body, 'body', MAX_BODY_LENGTH);
  const nowMs = clock.now();

  // Campaigns, cooldowns and event types are separate per audience. A driver
  // campaign never throttles a passenger message or sends it to passengers.
  const campaignRef = db.collection(config.campaigns).doc(campaignId);
  const existing = await campaignRef.get();
  if (existing && existing.exists) {
    // Replay of a campaign already sent: report it instead of notifying twice.
    const prior = existing.data() || {};
    logInfo(context, `${audience}.broadcast.replay_ignored`, {
      operation: `${audience}_broadcast`,
      campaignId,
      recipientCount: Number(prior.recipientCount || 0),
    });
    return {
      campaignId,
      recipientCount: Number(prior.recipientCount || 0),
      skippedCount: Number(prior.skippedCount || 0),
      replay: true,
    };
  }

  await assertSendingAllowed({ db, nowMs, campaigns: config.campaigns });

  const profiles = db.collection(config.profiles);
  const profilesSnap = await (audience === 'driver'
    ? profiles.where('verificationStatus', '==', 'approved').get()
    : profiles.orderBy('__name__').get());

  const recipients = [];
  let skippedCount = 0;
  profilesSnap.forEach((doc) => {
    if (config.eligible(doc.data() || {})) recipients.push(doc.id);
    else skippedCount += 1;
  });

  if (recipients.length === 0) {
    logWarning(context, `${audience}.broadcast.no_recipients`, {
      operation: `${audience}_broadcast`,
      campaignId,
      skippedCount,
    });
    return { campaignId, recipientCount: 0, skippedCount, replay: false };
  }

  // Events are batched and use deterministic ids. A retry after a partial batch
  // failure reuses the same ids, so a successfully created event is not sent
  // twice by the onCreate delivery trigger.
  for (let start = 0; start < recipients.length; start += BATCH_LIMIT) {
    const chunk = recipients.slice(start, start + BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach((recipientUid) => {
      const event = buildNotificationEvent({
        // Campaign id stands in for rideId: it keeps event ids deterministic and
        // carries no ride context, which is exactly what this message is.
        rideId: campaignId,
        eventType: config.eventType,
        recipientUid,
        recipientRole: audience,
        route: config.route,
        dedupeSuffix: recipientUid,
        traceId: (context && context.traceId) || null,
        nowMs,
      });
      batch.set(db.collection(C.NOTIFICATION_EVENTS).doc(event.id), {
        ...event.data,
        // Admin-authored copy travels with the event: the sender reads it back
        // instead of using the static per-eventType presentation table.
        broadcastTitle: title,
        broadcastBody: body,
      });
    });
    await batch.commit();
  }

  await campaignRef.set({
    campaignId,
    createdAtMs: nowMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    recipientCount: recipients.length,
    skippedCount,
    // Who sent what, for accountability. The copy is admin-authored and safe to
    // retain; no recipient identifiers are stored here.
    sentByAdminUid: adminUid,
    title,
    body,
  });

  logInfo(context, `${audience}.broadcast.sent`, {
    operation: `${audience}_broadcast`,
    campaignId,
    recipientCount: recipients.length,
    skippedCount,
  });

  return {
    campaignId,
    recipientCount: recipients.length,
    skippedCount,
    replay: false,
  };
}

function sendDriverBroadcast(args) {
  return sendAudienceBroadcast({ ...args, audience: 'driver' });
}

function sendPassengerBroadcast(args) {
  return sendAudienceBroadcast({ ...args, audience: 'passenger' });
}

module.exports = {
  sendDriverBroadcast,
  sendPassengerBroadcast,
  isBroadcastRecipient,
  isPassengerBroadcastRecipient,
  validateCampaignId,
  validateMessageText,
  BROADCAST_CAMPAIGNS,
  PASSENGER_BROADCAST_CAMPAIGNS,
  MIN_INTERVAL_MS,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
};
