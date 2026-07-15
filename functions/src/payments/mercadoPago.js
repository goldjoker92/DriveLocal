// @ts-check
// Isolated Mercado Pago adapter (Checkout Transparente — Orders API + official
// Orders webhook signature model). This is the ONLY module that talks to the
// provider. Responsibilities:
//   - create a Pix order;
//   - fetch an order by provider id;
//   - validate a webhook x-signature (official manifest method);
//   - normalize the provider response into DriveLocal fields;
//   - time out external requests;
//   - reuse the same provider idempotency key on retry.
//
// Money is integer centavos internally; BRL decimal strings are used ONLY at the
// provider boundary. The adapter NEVER returns raw provider payloads to callers,
// so nothing leaks to the app.

const { createHmac, timingSafeEqual } = require('crypto');
const { AppError, ERROR_CODES } = require('../errors/appError');
const C = require('./constants');

const DEFAULT_BASE_URL = 'https://api.mercadopago.com';

// ---- money conversion (boundary only) --------------------------------------

// 1234 centavos -> "12.34" (provider expects BRL decimal with 2 places).
function centavosToBrlString(centavos) {
  const n = Number(centavos);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `centavosToBrlString: invalid centavos ${centavos}`,
    });
  }
  return (n / 100).toFixed(2);
}

// "12.34" (or number) -> 1234 centavos. Rounds to the nearest centavo.
function brlToCentavos(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// ---- normalization ----------------------------------------------------------

// Maps provider order/payment states into a single normalized DriveLocal status.
// Anything unknown or internally inconsistent becomes manual_review (never paid).
function normalizeStatus(orderStatus, paymentStatus) {
  const o = String(orderStatus || '').toLowerCase();
  const p = String(paymentStatus || '').toLowerCase();

  if (o === 'refunded' || o === 'partially_refunded' || p === 'refunded' || p === 'charged_back') {
    return C.STATUS.REFUNDED;
  }
  if (o === 'processed' || p === 'approved' || p === 'accredited') return C.STATUS.PAID;
  if (o === 'expired' || p === 'expired') return C.STATUS.EXPIRED;
  if (o === 'canceled' || o === 'cancelled' || p === 'cancelled' || p === 'canceled') {
    return C.STATUS.CANCELLED;
  }
  if (p === 'rejected') return C.STATUS.FAILED;
  if (o === 'created' || o === 'processing' || o === 'action_required' || p === 'pending' || p === 'in_process') {
    return C.STATUS.PENDING;
  }
  // Unknown / inconsistent — force human review rather than assuming success.
  return C.STATUS.MANUAL_REVIEW;
}

// Defensive extraction of the Pix QR data across known Orders API shapes.
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
  for (const c of candidates) {
    if (c && (c.qr_code || c.qr_code_base64)) {
      return { qrCode: c.qr_code || null, qrCodeBase64: c.qr_code_base64 || null };
    }
  }
  return { qrCode: null, qrCodeBase64: null };
}

// Turns a raw provider order into safe DriveLocal fields. No raw payload leaks.
function normalizeOrder(order) {
  const o = order || {};
  const payment =
    o.transactions && Array.isArray(o.transactions.payments) ? o.transactions.payments[0] : null;
  const totalAmountCentavos = brlToCentavos(o.total_amount != null ? o.total_amount : payment && payment.amount);
  const processedMs = o.last_updated ? Date.parse(o.last_updated) : NaN;
  return {
    providerOrderId: o.id != null ? String(o.id) : null,
    externalReference: o.external_reference != null ? String(o.external_reference) : null,
    normalizedStatus: normalizeStatus(o.status, payment && payment.status),
    totalAmountCentavos,
    currency: (o.currency || (payment && payment.currency) || C.CURRENCY),
    processingMs: Number.isFinite(processedMs) ? processedMs : null,
    ...extractPixData(o),
  };
}

// ---- webhook signature (official Orders manifest) ---------------------------

// Parses "ts=1699,v1=abcdef" into { ts, v1 }.
function parseSignatureHeader(xSignature) {
  const out = { ts: null, v1: null };
  if (typeof xSignature !== 'string') return out;
  for (const part of xSignature.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 'ts') out.ts = v;
    if (k === 'v1') out.v1 = v;
  }
  return out;
}

/**
 * Validates the Mercado Pago webhook signature using the official manifest:
 *   `id:{data.id};request-id:{x-request-id};ts:{ts};`
 * HMAC-SHA256 with the webhook secret, compared to v1 in constant time.
 * `data.id` is lowercased per the provider's alphanumeric rule.
 * @param {{xSignature?:string, xRequestId?:string, dataId?:string, secret:string}} p
 * @returns {boolean}
 */
function verifyWebhookSignature(p) {
  const { xSignature, xRequestId, dataId, secret } = p || {};
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

// ---- HTTP with timeout ------------------------------------------------------

async function requestJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    // Abort (timeout) vs other network failure.
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new AppError(ERROR_CODES.PROVIDER_TIMEOUT, { internalMessage: 'mercado pago request timed out', cause: err });
    }
    throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, { internalMessage: 'mercado pago request failed', cause: err });
  }
  clearTimeout(timer);

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_e) {
    json = {};
  }
  if (res.status === 401 || res.status === 403) {
    // Bad/expired credentials — a configuration problem, not a client error.
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: `mercado pago auth rejected (status ${res.status})`,
    });
  }
  if (res.status >= 500) {
    throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, {
      internalMessage: `mercado pago server error (status ${res.status})`,
    });
  }
  if (res.status >= 400) {
    // Other 4xx — surface a safe generic provider-unavailable to the app; the
    // provider detail stays server-side in the internal message only.
    throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, {
      internalMessage: `mercado pago rejected request (status ${res.status})`,
    });
  }
  return json;
}

/**
 * Builds a Mercado Pago adapter bound to one access token.
 * @param {{accessToken:string, baseUrl?:string, timeoutMs?:number, fetchImpl?:Function}} cfg
 */
function createMercadoPagoAdapter(cfg = {}) {
  const accessToken = cfg.accessToken;
  const baseUrl = cfg.baseUrl || DEFAULT_BASE_URL;
  const timeoutMs = cfg.timeoutMs || C.PROVIDER_TIMEOUT_MS;
  const fetchImpl = cfg.fetchImpl || (typeof fetch === 'function' ? fetch : null);

  if (!accessToken) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, { internalMessage: 'mercado pago access token missing' });
  }
  if (!fetchImpl) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, { internalMessage: 'no fetch implementation available' });
  }

  function authHeaders(idempotencyKey) {
    const h = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey) h['X-Idempotency-Key'] = idempotencyKey;
    return h;
  }

  return {
    /**
     * Creates a Pix order. `localPaymentId` is the immutable external_reference.
     * Metadata carries NO CPF/phone/Pix key/documents.
     * @param {{localPaymentId:string, amountCentavos:number, idempotencyKey:string, purpose:string, description?:string}} p
     */
    async createPixOrder(p) {
      const amount = centavosToBrlString(p.amountCentavos);
      const body = {
        type: 'online',
        processing_mode: 'automatic',
        total_amount: amount,
        external_reference: p.localPaymentId,
        description: p.description || 'DriveLocal',
        transactions: {
          payments: [
            {
              amount,
              payment_method: { id: 'pix', type: 'bank_transfer' },
            },
          ],
        },
        // Safe, non-PII metadata only.
        metadata: { purpose: p.purpose, localPaymentId: p.localPaymentId },
      };
      const json = await requestJson(
        fetchImpl,
        `${baseUrl}/v1/orders`,
        { method: 'POST', headers: authHeaders(p.idempotencyKey), body: JSON.stringify(body) },
        timeoutMs
      );
      const norm = normalizeOrder(json);
      return {
        providerOrderId: norm.providerOrderId,
        normalizedStatus: norm.normalizedStatus,
        qrCode: norm.qrCode,
        qrCodeBase64: norm.qrCodeBase64,
        totalAmountCentavos: norm.totalAmountCentavos,
        currency: norm.currency,
      };
    },

    /**
     * Refetches a complete order and returns normalized (safe) fields only.
     * @param {string} providerOrderId
     */
    async getOrder(providerOrderId) {
      const json = await requestJson(
        fetchImpl,
        `${baseUrl}/v1/orders/${encodeURIComponent(providerOrderId)}`,
        { method: 'GET', headers: authHeaders(null) },
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
