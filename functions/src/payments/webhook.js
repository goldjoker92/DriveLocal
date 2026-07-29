// @ts-check
// mercadoPagoWebhook — HTTP handler for the official Orders webhook. Pure logic
// lives here (handleWebhook) so it is testable without the HTTP layer; the
// onRequest binding in callables.js only adapts req/res.
//
// Trust model: the webhook BODY is never trusted for status or amount. We only
// read the provider order id from it, then re-fetch and verify the full order.

const { createLoggerContext, logInfo, logWarning, logError } = require('../logging/logger');
const { AppError } = require('../errors/appError');
const { verifyWebhookSignature } = require('./mercadoPago');
const { verifyAndApplyOrder } = require('./verifyAndApply');

// Extracts the provider order id from the webhook body/query across shapes.
function extractOrderId(body, query) {
  const b = body || {};
  const q = query || {};
  if (b.data && b.data.id != null) return String(b.data.id);
  if (b.id != null && (b.type === 'order' || b.topic === 'merchant_order' || b.action)) return String(b.id);
  if (q['data.id'] != null) return String(q['data.id']);
  return null;
}

// Mercado Pago's notification simulator can send a complete synthetic Point
// order inside `data` (for example data.type="point", data.id="123456"). That
// identifier is not a real Orders API resource and therefore cannot be fetched
// from /v1/orders/{id}. Once the signed request has been authenticated, we only
// acknowledge this simulator/Point payload. We never trust or apply its amount,
// status or payment fields to DriveLocal.
function isSignedSimulatorPointPayload(body) {
  const data = body && body.data;
  return Boolean(
    data
      && typeof data === 'object'
      && data.type === 'point'
      && data.transactions
      && Array.isArray(data.transactions.payments)
  );
}

/**
 * @param {{db:object, adapter:object, webhookSecret:string, clock:{now:()=>number},
 *          environment?:string, headers:object, query:object, body:object,
 *          traceId?:string}} args
 * @returns {Promise<{httpStatus:number, body:object}>}
 */
async function handleWebhook(args) {
  const { db, adapter, webhookSecret, clock, environment, headers, query, body } = args;
  const context = createLoggerContext({
    traceId: args.traceId,
    functionName: 'mercadoPagoWebhook',
    environment,
    actorType: 'provider',
  });

  const h = headers || {};
  const xSignature = h['x-signature'] || h['X-Signature'];
  const xRequestId = h['x-request-id'] || h['X-Request-Id'];
  const dataId = extractOrderId(body, query);

  logInfo(context, 'payment.webhook.received', { operation: 'webhook', providerOrderId: dataId });

  // 1. Signature is mandatory. Invalid -> 401 (do not process).
  const validSig = verifyWebhookSignature({ xSignature, xRequestId, dataId, secret: webhookSecret });
  if (!validSig) {
    logWarning(context, 'payment.webhook.signature_invalid', { operation: 'webhook', providerOrderId: dataId });
    return { httpStatus: 401, body: { ok: false } };
  }

  // The official simulator may send a synthetic Point order whose id cannot be
  // retrieved from the Orders API. Acknowledge only after signature validation;
  // do not mutate Firestore and do not trust the embedded transaction details.
  if (isSignedSimulatorPointPayload(body)) {
    logInfo(context, 'payment.webhook.simulator_acknowledged', {
      operation: 'webhook',
      providerOrderId: dataId,
    });
    return { httpStatus: 200, body: { ok: true, outcome: 'simulator_acknowledged' } };
  }

  if (!dataId) {
    // Signed but nothing actionable — acknowledge to avoid infinite retries.
    return { httpStatus: 200, body: { ok: true } };
  }

  try {
    const res = await verifyAndApplyOrder({
      db,
      adapter,
      providerOrderId: dataId,
      context,
      clock,
      environment,
      source: 'webhook',
    });
    // Applied, duplicate, pending, terminal, verification_failed, manual_review
    // all acknowledge with 200 (a retry would not change the outcome).
    return { httpStatus: 200, body: { ok: true, outcome: res.outcome } };
  } catch (err) {
    const appErr = AppError.from(err);
    // Transient provider failure -> 500 so Mercado Pago retries later.
    logError(context, 'function_error', { operation: 'webhook', providerOrderId: dataId, errorCode: appErr.code, retryable: appErr.retryable });
    if (appErr.retryable) {
      return { httpStatus: 500, body: { ok: false } };
    }
    // Non-retryable server-side problem: acknowledge to avoid retry storms; the
    // failure is logged for investigation.
    return { httpStatus: 200, body: { ok: false } };
  }
}

module.exports = { handleWebhook, extractOrderId, isSignedSimulatorPointPayload };
