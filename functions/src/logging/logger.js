// @ts-check
// Structured logging for DriveLocal Cloud Functions.
//
// Uses the official Firebase Functions structured logger (firebase-functions/
// logger). No business function may emit an unstructured console.log. Every log
// entry carries a traceId (via a logger context) and is passed through recursive,
// deterministic redaction before being written.

const { randomUUID, createHash } = require('crypto');
const flogger = require('firebase-functions/logger');

// Short, non-reversible identifier hash for logs. Lets us correlate an actor or
// target across log lines WITHOUT ever writing the raw uid/token to logs.
function shortHash(value) {
  if (value == null) return null;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

// Keys whose values must NEVER be logged (case-insensitive substring match).
const SENSITIVE_KEY_PATTERNS = [
  'accesstoken', 'access_token', 'authorization', 'token', 'fcmtoken',
  'webhooksecret', 'webhook_secret', 'secret', 'password', 'passwd',
  'verificationcode', 'verification_code', 'otp',
  'cpf', 'cnpj', 'cnh', 'rg', 'identity',
  'phone', 'telefone', 'whatsapp',
  'email', 'pixkey', 'pix_key', 'address', 'endereco',
  'rawpayload', 'providerpayload',
];

// Exact identity keys. They cannot use substring matching because safe correlation
// fields such as actorUidHash and driverIdHash must remain visible.
const SENSITIVE_IDENTITY_KEYS = new Set([
  'uid',
  'actoruid',
  'subjectuid',
  'recipientuid',
  'targetuid',
  'targetuserid',
  'userid',
  'driverid',
  'passengerid',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_IDENTITY_KEYS.has(normalizedKey(key))
    || SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Recursively redacts sensitive keys in objects/arrays. Returns a NEW value and
 * NEVER mutates the input. Deterministic; depth-limited to avoid runaway/cyclic
 * structures. Dates -> ISO string; Errors -> safe summary (no stack).
 * @param {*} value
 * @param {number} [depth]
 */
function redactSensitiveData(value, depth = 0) {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactSensitiveData(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return `[Error: ${value.name}]`;
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactSensitiveData(value[key], depth + 1);
    }
    return out;
  }
  return value;
}

// A fresh, unique trace id for one request/event.
function createTraceId() {
  return `trace_${randomUUID()}`;
}

/**
 * Builds an immutable logger context carried through a request. A traceId is
 * generated when not supplied. actorUid remains available to handlers that may
 * already read it, but structured logging always redacts it and exposes only its
 * non-reversible actorUidHash.
 * @param {{traceId?:string, functionName?:string, environment?:string, actorType?:string, actorUid?:string}} [fields]
 */
function createLoggerContext(fields = {}) {
  return Object.freeze({
    traceId: fields.traceId || createTraceId(),
    functionName: fields.functionName,
    environment: fields.environment,
    actorType: fields.actorType,
    actorUid: fields.actorUid,
    actorUidHash: fields.actorUid ? shortHash(fields.actorUid) : undefined,
  });
}

function buildEntry(context, eventName, severity, extra) {
  const merged = { ...(context || {}), eventName, severity, ...(extra || {}) };
  return redactSensitiveData(merged);
}

function logInfo(context, eventName, extra) {
  flogger.info(eventName, buildEntry(context, eventName, 'INFO', extra));
}
function logWarning(context, eventName, extra) {
  flogger.warn(eventName, buildEntry(context, eventName, 'WARNING', extra));
}
// Errors are logged server-side only; a sanitized internal message may be
// included, but stack traces are never returned to the client.
function logError(context, eventName, extra) {
  flogger.error(eventName, buildEntry(context, eventName, 'ERROR', extra));
}

/**
 * Runs fn and returns { result, durationMs } using an injected clock (no hidden
 * Date.now()). fn may be sync or async.
 */
async function measureDuration(clock, fn) {
  const start = clock.now();
  const result = await fn();
  const end = clock.now();
  return { result, durationMs: end > start ? end - start : 0 };
}

module.exports = {
  createTraceId,
  createLoggerContext,
  redactSensitiveData,
  logInfo,
  logWarning,
  logError,
  measureDuration,
  shortHash,
  SENSITIVE_KEY_PATTERNS,
  SENSITIVE_IDENTITY_KEYS,
  REDACTED,
};
