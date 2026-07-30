// @ts-check
// Isolated Mercado Pago adapter (Checkout Transparente — Orders API + official
// Orders webhook signature model). This is the ONLY module that talks to the
// provider. It creates/fetches orders, validates webhook signatures, normalizes
// provider responses and keeps all raw payloads away from the mobile app.
//
// Money is integer centavos internally; BRL decimal strings are used only at the
// provider boundary. Payer/device data are request-only and are never returned.

const { createHmac, timingSafeEqual } = require('crypto');
const { AppError, ERROR_CODES } = require('../errors/appError');
const C = require('./constants');

const DEFAULT_BASE_URL = 'https://api.mercadopago.com';

function centavosToBrlString(centavos) {
  const n = Number(centavos);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `centavosToBrlString: invalid centavos ${centavos}`,
    });
  }
  return (n / 100).toFixed(2);
}

function brlToCentavos(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normalizeStatus(orderStatus, paymentStatus) {
  const o = String(orderStatus || '').toLowerCase();
  const p = String(paymentStatus || '').toLowerCase();

  if (o === 'refunded' || o === 'partially_refunded' || p === 'refunded' || p === 'charged_back') {
    return C.STATUS.REFUNDED;
  }
  if (o === 'processed' || p === 'approved' || p === 'accredited' || p === 'processed') {
    return C.STATUS.PAID;
  }
  if (o === 'expired' || p === 'expired') return C.STATUS.EXPIRED;
  if (o === 'canceled' || o === 'cancelled' || p === 'cancelled' || p === 'canceled') {
    return C.STATUS.CANCELLED;
  }
  if (p === 'rejected') return C.STATUS.FAILED;
  if (o === 'created' || o === 'processing' || o === 'action_required' || p === 'pending' || p === 'in_process') {
    return C.STATUS.PENDING;
  }
  return C.STATUS.MANUAL_REVIEW;
}

function extractPixData(order) {
  const payment =
    order && order.transactions && Array.isArray(order.transactions.payments)
      ? order.transactions.payments[0]
      : null;
  const candidates = [
    payment && payment.payment_method,
    payment && payment.point_of_interaction && payment.point_of_interaction.transaction_data,
    order && order.point_of_interaction && order.point_of_interaction.transaction_data,
  ];
  for (const candidate of candidates) {
    if (candidate && (candidate.qr_code || candidate.qr_code_base64)) {
      return {
        qrCode: candidate.qr_code || null,
        qrCodeBase64: candidate.qr_code_base64 || null,
      };
    }
  }
  return { qrCode: null, qrCodeBase64: null };
}

function normalizeOrder(order) {
  const o = order || {};
  const payment =
    o.transactions && Array.isArray(o.transactions.payments) ? o.transactions.payments[0] : null;
  const totalAmountCentavos = brlToCentavos(
    o.total_amount != null ? o.total_amount : payment && payment.amount
  );
  const updatedAt = o.last_updated || o.last_updated_date;
  const processedMs = updatedAt ? Date.parse(updatedAt) : NaN;
  return {
    providerOrderId: o.id != null ? String(o.id) : null,
    externalReference: o.external_reference != null ? String(o.external_reference) : null,
    normalizedStatus: normalizeStatus(o.status, payment && payment.status),
    totalAmountCentavos,
    currency: o.currency || (payment && payment.currency) || C.CURRENCY,
    processingMs: Number.isFinite(processedMs) ? processedMs : null,
    ...extractPixData(o),
  };
}

function parseSignatureHeader(xSignature) {
  const out = { ts: null, v1: null };
  if (typeof xSignature !== 'string') return out;
  for (const part of xSignature.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'ts') out.ts = value;
    if (key === 'v1') out.v1 = value;
  }
  return out;
}

/**
 * Official manifest: id:{data.id};request-id:{x-request-id};ts:{ts};
 * @param {{xSignature?:string, xRequestId?:string, dataId?:string, secret:string}} input
 */
function verifyWebhookSignature(input) {
  const { xSignature, xRequestId, dataId, secret } = input || {};
  if (!secret || !xSignature || dataId == null) return false;
  const { ts, v1 } = parseSignatureHeader(xSignature);
  if (!ts || !v1) return false;

  const id = String(dataId).toLowerCase();
  const manifest = `id:${id};request-id:${xRequestId || ''};ts:${ts};`;
  const expected = createHmac('sha256', String(secret)).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(v1), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function requestJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new AppError(ERROR_CODES.PROVIDER_TIMEOUT, {
        internalMessage: 'mercado pago request timed out',
        cause: err,
      });
    }
    throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, {
      internalMessage: 'mercado pago request failed',
      cause: err,
    });
  }
  clearTimeout(timer);

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = {};
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: `mercado pago auth rejected (status ${response.status})`,
    });
  }
  if (response.status >= 500) {
    throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, {
      internalMessage: `mercado pago server error (status ${response.status})`,
    });
  }
  if (response.status >= 400) {
    throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, {
      internalMessage: `mercado pago rejected request (status ${response.status})`,
    });
  }
  return json;
}

function assertPixOrderInput(input) {
  if (!input || !Array.isArray(input.items) || input.items.length !== 1) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'Mercado Pago Pix order requires exactly one item',
    });
  }
  if (!input.payer || typeof input.payer.email !== 'string') {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'Mercado Pago Pix order requires payer email',
    });
  }
}

/**
 * @param {{accessToken:string, baseUrl?:string, timeoutMs?:number, fetchImpl?:Function}} cfg
 */
function createMercadoPagoAdapter(cfg = {}) {
  const accessToken = cfg.accessToken;
  const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
  const timeoutMs = cfg.timeoutMs || C.PROVIDER_TIMEOUT_MS;
  const fetchImpl = cfg.fetchImpl || (typeof fetch === 'function' ? fetch : null);

  if (!accessToken) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: 'mercado pago access token missing',
    });
  }
  if (!fetchImpl) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: 'no fetch implementation available',
    });
  }

  function authHeaders(idempotencyKey, deviceSessionId) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    // This value must come from Mercado Pago's official security tooling. It is
    // forwarded only and never logged or stored by this adapter.
    if (deviceSessionId) headers['X-meli-session-id'] = deviceSessionId;
    return headers;
  }

  return {
    /**
     * Creates one Pix order for one digital DriveLocal item. Metadata carries no
     * CPF, email, phone, device id, Pix key or document data.
     * @param {{localPaymentId:string, amountCentavos:number, idempotencyKey:string,
     *          purpose:string, description?:string, payer:object, items:object[],
     *          additionalInfo?:object|null, deviceSessionId?:string|null}} input
     */
    async createPixOrder(input) {
      assertPixOrderInput(input);
      const amount = centavosToBrlString(input.amountCentavos);
      const body = {
        type: 'online',
        processing_mode: 'automatic',
        total_amount: amount,
        external_reference: input.localPaymentId,
        description: input.description || 'DriveLocal',
        items: input.items,
        payer: input.payer,
        transactions: {
          payments: [
            {
              amount,
              // Mercado Pago documents statement_descriptor for card methods.
              // Pix keeps only the supported id/type pair; the account-level
              // "Nome para extratos" must be configured as DRIVELOCAL.
              payment_method: { id: 'pix', type: 'bank_transfer' },
            },
          ],
        },
        ...(input.additionalInfo ? { additional_info: input.additionalInfo } : {}),
        metadata: {
          purpose: input.purpose,
          localPaymentId: input.localPaymentId,
        },
      };

      const json = await requestJson(
        fetchImpl,
        `${baseUrl}/v1/orders`,
        {
          method: 'POST',
          headers: authHeaders(input.idempotencyKey, input.deviceSessionId),
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      const normalized = normalizeOrder(json);
      return {
        providerOrderId: normalized.providerOrderId,
        normalizedStatus: normalized.normalizedStatus,
        qrCode: normalized.qrCode,
        qrCodeBase64: normalized.qrCodeBase64,
        totalAmountCentavos: normalized.totalAmountCentavos,
        currency: normalized.currency,
      };
    },

    async getOrder(providerOrderId) {
      const json = await requestJson(
        fetchImpl,
        `${baseUrl}/v1/orders/${encodeURIComponent(providerOrderId)}`,
        { method: 'GET', headers: authHeaders(null, null) },
        timeoutMs
      );
      return normalizeOrder(json);
    },
  };
}

module.exports = {
  createMercadoPagoAdapter,
  verifyWebhookSignature,
  normalizeOrder,
  normalizeStatus,
  centavosToBrlString,
  brlToCentavos,
};
