// @ts-check
// Only the accepted parties may chat. The transaction owns phase, rate limit,
// sequence and notification: a message never announces arrival or starts a ride.
const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateIdempotencyKey } = require('../validation/validators');
const { logInfo, logWarning } = require('../logging/logger');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const { actorRoleForRide, idempotencyHash, nextSequence } = require('./sendQuickMessage');
const { QUICK_MESSAGE_RATE_LIMIT_MS } = require('./quickMessageCatalog');
const C = require('./constants');

const MESSAGE_MAX_LENGTH = 280;
const MESSAGE_PHASES = new Set(['assigned', 'driver_arrived']);
const stamp = () => admin.firestore.FieldValue.serverTimestamp();

function messageText(value) {
  if (typeof value !== 'string' || value.length > 2000) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT);
  }
  // Preserve accents, emoji and line breaks; remove invisible control/direction
  // overrides. Counting Unicode code points matches the mobile character counter.
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '').trim();
  if (!text || !text.replace(/[\s\u200C\u200D\uFE0E\uFE0F]/g, '') || [...text].length > MESSAGE_MAX_LENGTH) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { safeMetadata: { reason: 'MESSAGE_INVALID_TEXT' } });
  }
  return text;
}

function requireParty(ride, uid) {
  if (!uid) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  const role = actorRoleForRide(ride, uid);
  if (!role) throw new AppError(ERROR_CODES.FORBIDDEN);
  return role;
}

async function openRideConversation({ db, request, context }) {
  if (!request?.auth?.uid) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  const payload = assertShape(request?.data, { required: ['rideId'], optional: [] });
  const rideId = validateIdentifier(payload.rideId, 'rideId');
  const result = await db.runTransaction(async (tx) => {
    const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
    const readyRef = db.collection(`${C.RIDE_REQUESTS}/${rideId}/conversation`).doc('state');
    const rideSnap = await tx.get(rideRef);
    const ride = rideSnap.data() || {};
    const role = requireParty(ride, request.auth.uid);
    const readySnap = await tx.get(readyRef);
    const ready = readySnap.data() || {};
    // A per-ride handshake prevents sending invisible text to a legacy app.
    // Merely opening the active ride on a new client is sufficient, no extra tap.
    if (ride.acceptedDriverId && MESSAGE_PHASES.has(ride.status) && ready[role] !== true) {
      tx.set(readyRef, { [role]: true }, { merge: true });
    }
    return { rideId, role, status: ride.status || null, traceId: context?.traceId || null };
  });
  logInfo(context, 'ride.conversation.opened', { rideId, senderRole: result.role, rideStatus: result.status });
  return result;
}

async function sendRideMessage({ db, request, context, clock }) {
  const uid = request?.auth?.uid;
  if (!uid) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  const payload = assertShape(request?.data, { required: ['rideId', 'text', 'idempotencyKey'], optional: [] });
  const rideId = validateIdentifier(payload.rideId, 'rideId');
  const text = messageText(payload.text);
  const key = validateIdempotencyKey(payload.idempotencyKey);
  const messageId = idempotencyHash(rideId, uid, key);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const messageRef = db.collection(`${C.RIDE_REQUESTS}/${rideId}/messages`).doc(messageId);
  logInfo(context, 'ride.message.started', { rideId, messageId });
  try {
    const result = await db.runTransaction(async (tx) => {
      const rideSnap = await tx.get(rideRef);
      const ride = rideSnap.data() || {};
      const senderRole = requireParty(ride, uid);
      const stored = await tx.get(messageRef);
      if (stored.exists) {
        const previous = stored.data();
        if (previous.kind !== 'text' || previous.text !== text || previous.senderRole !== senderRole) {
          throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT);
        }
        // A timeout may hide a successful commit. Replays remain valid after the
        // ride has started and do not consume another rate-limit slot or push.
        return { messageId, sequence: previous.sequence, status: ride.status, replay: true, traceId: previous.traceId };
      }
      if (!MESSAGE_PHASES.has(ride.status) || !ride.acceptedDriverId || ride.passengerDeleted || ride.driverDeleted) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, { safeMetadata: { reason: 'MESSAGE_CLOSED' } });
      }
      const recipientRole = senderRole === 'driver' ? 'passenger' : 'driver';
      const ready = (await tx.get(db.collection(`${C.RIDE_REQUESTS}/${rideId}/conversation`).doc('state'))).data() || {};
      if (ready.driver !== true || ready.passenger !== true) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, { safeMetadata: { reason: 'MESSAGE_PEER_NOT_READY' } });
      }
      const nowMs = Number(clock.now());
      const lastByRole = ride.quickMessageLastByRole || {};
      const lastMs = Number(lastByRole[senderRole]?.atMs || 0);
      const elapsed = Math.max(0, nowMs - lastMs);
      if (lastMs > 0 && elapsed < QUICK_MESSAGE_RATE_LIMIT_MS) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
          safeMetadata: { reason: 'QUICK_MESSAGE_RATE_LIMIT', remainingMs: QUICK_MESSAGE_RATE_LIMIT_MS - elapsed },
        });
      }
      const sequence = nextSequence(ride.quickMessageSequence);
      const notification = buildNotificationEvent({
        rideId, eventType: C.NOTIFICATION_EVENT.RIDE_MESSAGE,
        recipientUid: recipientRole === 'driver' ? ride.acceptedDriverId : ride.passengerId,
        recipientRole,
        // Legacy-safe route; new clients map message taps to the conversation.
        route: recipientRole === 'driver' ? '/active-ride' : '/driver-accepted',
        traceId: context?.traceId, nowMs, dedupeSuffix: `message_${sequence}_${recipientRole}`,
        expiresAtMs: nowMs + 5 * 60 * 1000,
      });
      tx.set(messageRef, {
        rideId, kind: 'text', text, senderRole, recipientRole, sequence,
        createdAtMs: nowMs, createdAt: stamp(), traceId: context?.traceId || null,
        notificationEventId: notification.id,
      });
      enqueueEventTx(tx, db, notification);
      tx.set(rideRef, {
        quickMessageSequence: sequence,
        quickMessageLastByRole: { ...lastByRole, [senderRole]: { atMs: nowMs } },
        quickMessageUpdatedAtMs: nowMs, quickMessageUpdatedAt: stamp(), updatedAt: stamp(),
      }, { merge: true });
      return { messageId, sequence, status: ride.status, replay: false, traceId: context?.traceId || null };
    });
    logInfo(context, result.replay ? 'ride.message.replayed' : 'ride.message.succeeded', {
      rideId, messageId, sequence: result.sequence, rideStatus: result.status,
    });
    return { rideId, ...result };
  } catch (error) {
    logWarning(context, 'ride.message.rejected', {
      rideId, messageId, errorCode: error?.code || 'INTERNAL_ERROR', reason: error?.safeMetadata?.reason || null,
    });
    if (error instanceof AppError) error.safeMetadata = { ...error.safeMetadata, traceId: context?.traceId || null, messageId };
    throw error;
  }
}

module.exports = { openRideConversation, sendRideMessage, messageText, MESSAGE_MAX_LENGTH };
