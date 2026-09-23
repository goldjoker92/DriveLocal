// @ts-check
// Callable/HTTP bindings for the Mercado Pago Pix payment domain. Thin adapters
// only: they resolve secrets, build the real provider adapter, resolve the
// environment, and delegate to the pure clock-injected handlers. Secrets are
// bound ONLY to the functions that need them.
//
// Secret NAMES are declared as Firebase Secret Manager parameters here; VALUES
// live exclusively in Secret Manager and are injected at runtime.

const { onCall, onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { systemClock } = require('../time/clock');
const { createLoggerContext, logError } = require('../logging/logger');
const { resolveEnvironment } = require('../config/environment');
const { createMercadoPagoAdapter } = require('./mercadoPago');
const { createDriverPixPayment } = require('./createPixPayment');
const { getDriverPaymentStatus, reprocessDriverPayment } = require('./paymentStatus');
const { handleWebhook } = require('./webhook');

const REGION = 'southamerica-east1';

// Secret Manager parameter declarations (names only — never values).
const MP_ACCESS_TOKEN = defineSecret('MERCADO_PAGO_ACCESS_TOKEN');
const MP_WEBHOOK_SECRET = defineSecret('MERCADO_PAGO_WEBHOOK_SECRET');

function buildAdapter() {
  return createMercadoPagoAdapter({ accessToken: MP_ACCESS_TOKEN.value() });
}

// createDriverPixPayment — needs the access token to create the order.
const createDriverPixPaymentFn = onCall(
  { region: REGION, secrets: [MP_ACCESS_TOKEN] },
  withCallableBoundary('createDriverPixPayment', (request, context) =>
    createDriverPixPayment({
      db: admin.firestore(),
      request,
      context: { ...context, environment: resolveEnvironment() },
      clock: systemClock,
      adapter: buildAdapter(),
    })
  )
);

// getDriverPaymentStatus — Firestore read only; no secrets bound.
const getDriverPaymentStatusFn = onCall(
  { region: REGION },
  withCallableBoundary('getDriverPaymentStatus', (request, context) =>
    getDriverPaymentStatus({ db: admin.firestore(), request, context, clock: systemClock })
  )
);

// Keep the old callable deployed until old APKs are retired. It cannot
// reactivate or request another charge.
const getDriverSubscriptionSnapshotFn = onCall(
  { region: REGION },
  withCallableBoundary('getDriverSubscriptionSnapshot', async () => {
    throw new AppError(ERROR_CODES.APP_UPDATE_REQUIRED);
  })
);

// reprocessDriverPayment — admin only; needs the access token to re-fetch.
const reprocessDriverPaymentFn = onCall(
  { region: REGION, secrets: [MP_ACCESS_TOKEN] },
  withCallableBoundary('reprocessDriverPayment', (request, context) =>
    reprocessDriverPayment({
      db: admin.firestore(),
      request,
      context,
      clock: systemClock,
      adapter: buildAdapter(),
      environment: resolveEnvironment(),
    })
  )
);

// mercadoPagoWebhook — HTTP; needs the webhook secret (verify) + access token
// (re-fetch). No callable boundary (it is not a callable); it returns raw status
// codes and never leaks internals in the body.
const mercadoPagoWebhookFn = onRequest(
  { region: REGION, secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET] },
  async (req, res) => {
    const context = createLoggerContext({ functionName: 'mercadoPagoWebhook', actorType: 'provider' });
    try {
      const environment = resolveEnvironment();
      const result = await handleWebhook({
        db: admin.firestore(),
        adapter: buildAdapter(),
        webhookSecret: MP_WEBHOOK_SECRET.value(),
        clock: systemClock,
        environment,
        headers: req.headers || {},
        query: req.query || {},
        body: req.body || {},
        traceId: context.traceId,
      });
      res.status(result.httpStatus).json(result.body);
    } catch (err) {
      const appErr = AppError.from(err);
      logError(context, 'function_error', { operation: 'webhook', errorCode: appErr.code });
      // Retryable -> 500 (provider will retry); otherwise acknowledge.
      res.status(appErr.retryable ? 500 : 200).json({ ok: false });
    }
  }
);

module.exports = {
  createDriverPixPayment: createDriverPixPaymentFn,
  getDriverPaymentStatus: getDriverPaymentStatusFn,
  getDriverSubscriptionSnapshot: getDriverSubscriptionSnapshotFn,
  reprocessDriverPayment: reprocessDriverPaymentFn,
  mercadoPagoWebhook: mercadoPagoWebhookFn,
  // Exported for deployment tooling / documentation of required secret names.
  SECRET_PARAMS: { MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET },
};
