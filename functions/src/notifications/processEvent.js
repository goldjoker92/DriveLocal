// @ts-check
// processRideNotificationEvent — the Firestore onCreate trigger logic for
// notificationEvents. Loads the recipient's active Android tokens, sends through
// Firebase Admin Messaging (real), records a safe result, disables invalid
// tokens, and is idempotent (a re-run on an already-processed event is ignored).
//
// The message contains a generic or server-catalogued visible notification plus a
// strict strings-only data payload. No coordinates, address, Pix, wallet or PII.

const { logInfo, logWarning } = require('../logging/logger');
const { quickMessagePresentation } = require('../rides/quickMessageCatalog');
const C = require('../rides/constants');

// FCM error codes meaning the token is dead and must be disabled.
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const PRESENTATION = Object.freeze({
  [C.NOTIFICATION_EVENT.OFFER_CREATED]: {
    title: 'Nova corrida disponível',
    body: 'Abra a DriveLocal para ver e aceitar a oferta.',
  },
  [C.NOTIFICATION_EVENT.RIDE_ASSIGNED]: {
    title: 'Motorista encontrado',
    body: 'Seu motorista está a caminho do embarque.',
  },
  [C.NOTIFICATION_EVENT.RIDE_ARRIVED]: {
    title: '🚗 Seu motorista chegou!',
    body: 'Ele está esperando no local de embarque.',
  },
  [C.NOTIFICATION_EVENT.RIDE_STARTED]: {
    title: 'Corrida iniciada',
    body: 'Sua corrida está em andamento.',
  },
  [C.NOTIFICATION_EVENT.RIDE_AWAITING_PAYMENT]: {
    title: 'Pagamento Pix disponível',
    body: 'Abra a corrida para pagar diretamente ao motorista.',
  },
  [C.NOTIFICATION_EVENT.RIDE_PAYMENT_MARKED_SENT]: {
    title: 'Passageiro informou o pagamento',
    body: 'Confira o recebimento do Pix antes de confirmar.',
  },
  [C.NOTIFICATION_EVENT.RIDE_COMPLETED]: {
    title: 'Corrida concluída',
    body: 'A corrida foi finalizada com sucesso.',
  },
  [C.NOTIFICATION_EVENT.RIDE_CANCELLED]: {
    title: 'Corrida cancelada',
    body: 'A corrida foi cancelada. Abra o app para continuar.',
  },
  [C.NOTIFICATION_EVENT.RIDE_DISPUTED]: {
    title: 'Pagamento em análise',
    body: 'Foi registrado um problema no pagamento da corrida.',
  },
});

function presentationForEvent(event) {
  if (event?.eventType === C.NOTIFICATION_EVENT.RIDE_QUICK_MESSAGE) {
    return quickMessagePresentation(event.messageCode);
  }
  return PRESENTATION[event?.eventType] || {
    title: 'Atualização da corrida',
    body: 'Abra a DriveLocal para ver os detalhes.',
  };
}

function dataPayload(event) {
  return {
    notificationId: String(event.notificationId),
    eventType: String(event.eventType),
    rideId: String(event.rideId),
    offerId: event.offerId ? String(event.offerId) : '',
    ...(event.messageCode ? { messageCode: String(event.messageCode) } : {}),
    recipientRole: String(event.recipientRole),
    route: event.route ? String(event.route) : '',
    traceId: event.traceId ? String(event.traceId) : '',
  };
}

function safeAndroidTag(event) {
  return `drivelocal_${String(event?.notificationId || event?.rideId || 'ride')}`
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 120);
}

function safeCollapseKey(event) {
  return `ride_${String(event?.rideId || 'status')}`
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64);
}

// Each capability names the offer channel that actually exists on the device.
// Anything unknown or missing degrades to the immutable legacy channel, which
// every app version has.
const RIDE_OFFER_CHANNEL_BY_CAPABILITY = Object.freeze({
  [C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V3]: C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V3,
  [C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2]: C.NOTIFICATION_CHANNELS.RIDE_OFFERS_V2,
});

function safeRideOfferChannelCapability(value) {
  return Object.prototype.hasOwnProperty.call(RIDE_OFFER_CHANNEL_BY_CAPABILITY, value)
    ? value
    : C.RIDE_OFFER_CHANNEL_CAPABILITIES.LEGACY_V1;
}

function androidNotificationForEvent(event, options = {}) {
  const isOffer = event.eventType === C.NOTIFICATION_EVENT.OFFER_CREATED;
  const isDriverArrival = event.eventType === C.NOTIFICATION_EVENT.RIDE_ARRIVED;
  const rideOfferChannelCapability = safeRideOfferChannelCapability(
    options.rideOfferChannelCapability
  );
  const soundOfferChannelId = RIDE_OFFER_CHANNEL_BY_CAPABILITY[rideOfferChannelCapability];
  const usesSoundOfferChannel = isOffer && Boolean(soundOfferChannelId);
  const channelId = isDriverArrival
    ? C.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL
    : isOffer
      ? usesSoundOfferChannel
        ? soundOfferChannelId
        : C.NOTIFICATION_CHANNELS.RIDE_OFFERS
      : C.NOTIFICATION_CHANNELS.RIDE_STATUS;

  const common = {
    channelId,
    tag: safeAndroidTag(event),
  };

  if (!isDriverArrival) {
    return {
      ...common,
      sound: usesSoundOfferChannel ? C.NOTIFICATION_SOUNDS.RIDE_OFFER : 'default',
      defaultVibrateTimings: true,
      // A ride offer is as time-critical as an arrival and must be allowed to
      // interrupt: max priority drives the heads-up banner on Android 7 and
      // below, where the channel importance does not exist, and public
      // visibility lets a locked screen show it. Both were already set for
      // arrival; leaving them off for offers was an oversight, not a decision.
      // Everything else stays on the standard status channel.
      ...(isOffer ? { priority: 'max', visibility: 'public' } : {}),
    };
  }

  return {
    ...common,
    sound: C.NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
    defaultVibrateTimings: false,
    vibrateTimingsMillis: [...C.DRIVER_ARRIVAL_VIBRATION_PATTERN],
    priority: 'max',
    visibility: 'public',
  };
}

// Generic ceiling for status updates, which stay useful for a while.
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * How long FCM may keep retrying delivery. An offer is worthless once it has
 * expired: a phone that reconnects five minutes later must NOT be woken up for
 * a ride that was assigned or closed long ago. Events without a deadline keep
 * the generic ceiling.
 *
 * @param {object} event
 * @param {number} nowMs
 * @returns {number} ttl in milliseconds, never negative
 */
function ttlMsForEvent(event, nowMs) {
  const expiresAtMs = Number(event?.expiresAtMs || 0);
  if (!(expiresAtMs > 0)) return DEFAULT_TTL_MS;
  // Already expired: 0 tells FCM "deliver now if the device is reachable,
  // otherwise drop it" rather than storing a dead offer.
  return Math.max(0, Math.min(DEFAULT_TTL_MS, expiresAtMs - Number(nowMs || 0)));
}

function buildMulticastMessage(event, tokens, options = {}) {
  const presentation = presentationForEvent(event);
  const nowMs = Number(options.nowMs) > 0 ? Number(options.nowMs) : Date.now();

  return {
    tokens,
    notification: presentation,
    data: dataPayload(event),
    android: {
      priority: 'high',
      ttl: ttlMsForEvent(event, nowMs),
      collapseKey: safeCollapseKey(event),
      notification: androidNotificationForEvent(event, options),
    },
  };
}

function buildTokenMessage(event, target, options = {}) {
  const multicast = buildMulticastMessage(event, [target.token], {
    rideOfferChannelCapability: target.rideOfferChannelCapability,
    nowMs: options.nowMs,
  });
  const { tokens: _tokens, ...message } = multicast;
  return { ...message, token: target.token };
}

/**
 * @param {{db:object, messaging:object, eventRef:object, event:object, context:object, clock:{now:()=>number}}} args
 */
async function processRideNotificationEvent({ db, messaging, eventRef, event, context, clock }) {
  // Idempotent: only a still-pending event is processed.
  if (!event || event.status !== C.NOTIFICATION_STATUS.PENDING) {
    logInfo(context, 'notification.duplicate_ignored', { operation: 'notify', notificationId: event && event.notificationId });
    return { skipped: true };
  }
  const nowMs = clock.now();

  const snap = await db
    .collection(C.NOTIFICATION_TOKENS)
    .where('uid', '==', event.recipientUid)
    .where('active', '==', true)
    .get();
  const targets = [];
  snap.forEach((d) => {
    const t = d.data() || {};
    if (t.platform === 'android' && t.token) {
      targets.push({
        ref: d.ref,
        token: t.token,
        rideOfferChannelCapability: safeRideOfferChannelCapability(
          t.rideOfferChannelCapability
        ),
      });
    }
  });

  if (targets.length === 0) {
    await eventRef.set({
      status: C.NOTIFICATION_STATUS.FAILED,
      failureReason: 'no_active_tokens',
      processedAtMs: nowMs,
      attemptCount: (event.attemptCount || 0) + 1,
    }, { merge: true });
    logWarning(context, 'notification.failed', {
      operation: 'notify', notificationId: event.notificationId,
      reasonCode: 'no_active_tokens',
    });
    return { status: C.NOTIFICATION_STATUS.FAILED, successCount: 0, failureCount: 0 };
  }

  const isOffer = event.eventType === C.NOTIFICATION_EVENT.OFFER_CREATED;
  const v2TargetCount = isOffer
    ? targets.filter((target) => (
        target.rideOfferChannelCapability
          === C.RIDE_OFFER_CHANNEL_CAPABILITIES.CUSTOM_SOUND_V2
      )).length
    : 0;
  const legacyTargetCount = isOffer ? targets.length - v2TargetCount : 0;

  if (isOffer) {
    logInfo(context, 'notification.offer_channels_selected', {
      operation: 'notify',
      notificationId: event.notificationId,
      v2TargetCount,
      legacyTargetCount,
      targetCount: targets.length,
    });
  }

  // sendEach accepts one message per token in a single provider operation. This
  // lets V1 and V2 devices coexist without duplicate notifications or two
  // partially successful multicast calls during the migration.
  const resp = await messaging.sendEach(
    targets.map((target) => buildTokenMessage(event, target, { nowMs }))
  );

  let successCount = 0;
  let failureCount = 0;
  const disables = [];
  (resp.responses || []).forEach((r, i) => {
    if (r && r.success) {
      successCount += 1;
    } else {
      failureCount += 1;
      const code = r && r.error && r.error.code;
      if (INVALID_TOKEN_CODES.has(code)) {
        disables.push(targets[i].ref.set({
          active: false,
          disabledReason: code,
          disabledAtMs: nowMs,
        }, { merge: true }));
      }
    }
  });
  await Promise.all(disables);

  const status =
    failureCount === 0
      ? C.NOTIFICATION_STATUS.SENT
      : successCount > 0
        ? C.NOTIFICATION_STATUS.PARTIALLY_FAILED
        : C.NOTIFICATION_STATUS.FAILED;
  await eventRef.set({
    status,
    successCount,
    failureCount,
    processedAtMs: nowMs,
    attemptCount: (event.attemptCount || 0) + 1,
  }, { merge: true });

  const logEvent = status === C.NOTIFICATION_STATUS.FAILED ? 'notification.failed' : 'notification.sent';
  logInfo(context, logEvent, {
    operation: 'notify',
    notificationId: event.notificationId,
    rideId: event.rideId,
    eventType: event.eventType,
    successCount,
    failureCount,
    ...(isOffer ? { v2TargetCount, legacyTargetCount } : {}),
  });
  return { status, successCount, failureCount };
}

module.exports = {
  processRideNotificationEvent,
  buildMulticastMessage,
  buildTokenMessage,
  androidNotificationForEvent,
  presentationForEvent,
  dataPayload,
  safeAndroidTag,
  safeCollapseKey,
  safeRideOfferChannelCapability,
  ttlMsForEvent,
  DEFAULT_TTL_MS,
  INVALID_TOKEN_CODES,
  PRESENTATION,
};
