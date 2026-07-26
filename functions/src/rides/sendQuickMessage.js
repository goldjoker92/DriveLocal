// @ts-check
// Secure predefined ride messages. The authenticated actor is derived from the
// server ride, free text is impossible, history is a six-slot ring buffer and the
// notification event is committed atomically with the message.

const crypto = require('crypto');
const admin = require('firebase-admin');

const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateIdentifier,
  validateIdempotencyKey,
  validateNonEmptyString,
} = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const C = require('./constants');
const {
  QUICK_MESSAGE_HISTORY_LIMIT,
  QUICK_MESSAGE_RATE_LIMIT_MS,
  QUICK_MESSAGE_RETENTION_MS,
  isQuickMessageAllowed,
} = require('./quickMessageCatalog');

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function quickMessageArgs(request) {
  const payload = assertShape(request?.data, {
    required: ['rideId', 'messageCode', 'idempotencyKey'],
    optional: [],
  });
  return {
    rideId: validateIdentifier(payload.rideId, 'rideId'),
    messageCode: validateNonEmptyString(payload.messageCode, 'messageCode').slice(0, 60),
    idempotencyKey: validateIdempotencyKey(payload.idempotencyKey),
  };
}

function actorRoleForRide(ride, uid) {
  if (ride?.acceptedDriverId === uid) return 'driver';
  if (ride?.passengerId === uid) return 'passenger';
  return null;
}

function idempotencyHash(rideId, uid, idempotencyKey) {
  return crypto
    .createHash('sha256')
    .update(`${rideId}:${uid}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24);
}

function safeLastByRole(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeRecentKeys(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && /^[a-f0-9]{24}$/.test(item)).slice(-10)
    : [];
}

async function sendRideQuickMessage({ db, request, context, clock }) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'quick ride message without authentication',
    });
  }

  const { rideId, messageCode, idempotencyKey } = quickMessageArgs(request);
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const keyHash = idempotencyHash(rideId, uid, idempotencyKey);

  const out = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: 'ride not found for quick message',
      });
    }

    const ride = rideSnap.data() || {};
    const senderRole = actorRoleForRide(ride, uid);
    if (!senderRole) {
      throw new AppError(ERROR_CODES.FORBIDDEN, {
        internalMessage: 'quick message caller is not a ride party',
      });
    }

    const recentKeys = safeRecentKeys(ride.quickMessageRecentKeys);
    if (recentKeys.includes(keyHash)) {
      return {
        replay: true,
        senderRole,
        messageCode,
        rideStatus: ride.status || null,
        sequence: Number(ride.quickMessageSequence || 0),
      };
    }

    if (!isQuickMessageAllowed(senderRole, ride.status, messageCode)) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'quick message is not allowed for actor role and ride status',
        safeMetadata: {
          reason: 'QUICK_MESSAGE_NOT_ALLOWED',
          senderRole,
          rideStatus: String(ride.status || 'unknown'),
        },
      });
    }

    const nowMs = Number(clock.now());
    const lastByRole = safeLastByRole(ride.quickMessageLastByRole);
    const previous = lastByRole[senderRole] && typeof lastByRole[senderRole] === 'object'
      ? lastByRole[senderRole]
      : {};
    const elapsedMs = Math.max(0, nowMs - Number(previous.atMs || 0));
    if (Number(previous.atMs || 0) > 0 && elapsedMs < QUICK_MESSAGE_RATE_LIMIT_MS) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'quick message rate limit active',
        safeMetadata: {
          reason: 'QUICK_MESSAGE_RATE_LIMIT',
          remainingMs: QUICK_MESSAGE_RATE_LIMIT_MS - elapsedMs,
        },
      });
    }

    const recipientRole = senderRole === 'driver' ? 'passenger' : 'driver';
    const recipientUid = recipientRole === 'driver' ? ride.acceptedDriverId : ride.passengerId;
    if (!recipientUid) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'quick message recipient is missing',
        safeMetadata: { reason: 'QUICK_MESSAGE_RECIPIENT_MISSING' },
      });
    }

    const sequence = Math.max(0, Number(ride.quickMessageSequence || 0)) + 1;
    const slot = sequence % QUICK_MESSAGE_HISTORY_LIMIT;
    const messageRef = rideRef.collection('quickMessages').doc(`slot_${slot}`);
    const route = recipientRole === 'driver' ? '/active-ride' : '/driver-accepted';
    const notification = buildNotificationEvent({
      rideId,
      eventType: C.NOTIFICATION_EVENT.RIDE_QUICK_MESSAGE,
      recipientUid,
      recipientRole,
      route,
      traceId: context?.traceId,
      nowMs,
      messageCode,
      dedupeSuffix: `quick_${sequence}_${recipientRole}`,
    });

    tx.set(messageRef, {
      rideId,
      sequence,
      messageCode,
      senderRole,
      recipientRole,
      createdAtMs: nowMs,
      createdAt: ts(),
      expiresAtMs: nowMs + QUICK_MESSAGE_RETENTION_MS,
      notificationEventId: notification.id,
    });
    enqueueEventTx(tx, db, notification);
    tx.set(rideRef, {
      quickMessageSequence: sequence,
      quickMessageRecentKeys: [...recentKeys.slice(-9), keyHash],
      quickMessageLastByRole: {
        ...lastByRole,
        [senderRole]: { atMs: nowMs, messageCode },
      },
      quickMessageUpdatedAtMs: nowMs,
      quickMessageUpdatedAt: ts(),
      updatedAt: ts(),
    }, { merge: true });

    return {
      replay: false,
      senderRole,
      recipientRole,
      messageCode,
      rideStatus: ride.status,
      sequence,
      notificationId: notification.id,
    };
  });

  logInfo(context, out.replay ? 'ride.quick_message_replayed' : 'ride.quick_message_sent', {
    operation: 'send_quick_message',
    rideId,
    senderRole: out.senderRole,
    recipientRole: out.recipientRole || null,
    messageCode: out.messageCode,
    rideStatus: out.rideStatus,
    sequence: out.sequence,
    notificationQueued: Boolean(out.notificationId),
  });

  return {
    rideId,
    status: out.rideStatus,
    messageCode: out.messageCode,
    sequence: out.sequence,
    replay: out.replay === true,
  };
}

module.exports = {
  sendRideQuickMessage,
  quickMessageArgs,
  actorRoleForRide,
  idempotencyHash,
};
