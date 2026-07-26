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
    title: 'Motorista chegou',
    body: 'Seu motorista chegou ao local de embarque.',
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

function buildMulticastMessage(event, tokens) {
  const presentation = presentationForEvent(event);
  const channelId = event.eventType === C.NOTIFICATION_EVENT.OFFER_CREATED
    ? C.NOTIFICATION_CHANNELS.RIDE_OFFERS
    : C.NOTIFICATION_CHANNELS.RIDE_STATUS;

  return {
    tokens,
    notification: presentation,
    data: dataPayload(event),
    android: {
      priority: 'high',
      notification: {
        channelId,
        sound: 'default',
        defaultVibrateTimings: true,
      },
    },
  };
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
    if (t.platform === 'android' && t.token) targets.push({ ref: d.ref, token: t.token });
  });

  if (targets.length === 0) {
    await eventRef.set({ status: C.NOTIFICATION_STATUS.FAILED, failureReason: 'no_active_tokens', processedAtMs: nowMs, attemptCount: (event.attemptCount || 0) + 1 }, { merge: true });
    logWarning(context, 'notification.failed', { operation: 'notify', notificationId: event.notificationId, reasonCode: 'no_active_tokens' });
    return { status: C.NOTIFICATION_STATUS.FAILED, successCount: 0, failureCount: 0 };
  }

  const resp = await messaging.sendEachForMulticast(
    buildMulticastMessage(event, targets.map((t) => t.token))
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
        disables.push(targets[i].ref.set({ active: false, disabledReason: code, disabledAtMs: nowMs }, { merge: true }));
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
  await eventRef.set({ status, successCount, failureCount, processedAtMs: nowMs, attemptCount: (event.attemptCount || 0) + 1 }, { merge: true });

  const logEvent = status === C.NOTIFICATION_STATUS.FAILED ? 'notification.failed' : 'notification.sent';
  logInfo(context, logEvent, { operation: 'notify', notificationId: event.notificationId, rideId: event.rideId, eventType: event.eventType, successCount, failureCount });
  return { status, successCount, failureCount };
}

module.exports = {
  processRideNotificationEvent,
  buildMulticastMessage,
  presentationForEvent,
  dataPayload,
  INVALID_TOKEN_CODES,
  PRESENTATION,
};
