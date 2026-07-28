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
// Keep operational status/version/count fields visible, but fail closed for
// identity, exact route/location and provider payload fields.
//
// Very short document identifiers such as `rg` must NOT live in this list:
// substring matching would also redact unrelated safe fields such as
// `targetUserIdHash`. Those identifiers belong in SENSITIVE_IDENTITY_KEYS below.
const SENSITIVE_KEY_PATTERNS = [
  'accesstoken', 'access_token', 'authorization', 'token', 'fcmtoken',
  'webhooksecret', 'webhook_secret', 'secret', 'password', 'passwd',
  'verificationcode', 'verification_code', 'otp',
  'cpf', 'cnpj', 'cnh', 'identity',
  'fullname', 'passengername', 'drivername',
  'phone', 'telefone', 'whatsapp',
  'email', 'pixkey', 'pix_key', 'pixpayload', 'pix_payload', 'copiaecola',
  'address', 'endereco', 'logradouro', 'street',
  'pickup', 'destination', 'origin', 'coordinates', 'location',
  'rawpayload', 'providerpayload', 'provider_payload', 'requestpayload',
  'internalmessage',
];

// Exact identity/location keys. They cannot all use substring matching because
// safe correlation fields such as actorUidHash and driverIdHash must remain visible.
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
  'rg',
  'registrogeral',
  'lat',
  'lng',
  'latitude',
  'longitude',
]);

const OPERATIONAL_PHASES = new Set([
  'requested',
  'started',
  'succeeded',
  'failed',
  'restored',
  'duplicate_ignored',
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

function deriveOperationalPhase(eventName, explicitPhase = null) {
  const explicit = String(explicitPhase || '').trim().toLowerCase();
  if (OPERATIONAL_PHASES.has(explicit)) return explicit;

  const event = String(eventName || '').trim().toLowerCase();
  if (event.includes('duplicate_ignored')) return 'duplicate_ignored';
  if (/(restored|recovered|replayed|resume)/.test(event)) return 'restored';
  if (/(requested|request_started)/.test(event)) return 'requested';
  if (/(started|starting|attempted)/.test(event)) return 'started';
  if (/(failed|failure|rejected|denied|error|expired)/.test(event)) return 'failed';
  if (/(succeeded|success|sent|completed|confirmed|captured|created|accepted|arrived|won|cancelled)/.test(event)) {
    return 'succeeded';
  }
  return null;
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
  const context = {
    traceId: fields.traceId || createTraceId(),
    functionName: fields.functionName,
    environment: fields.environment,
    actorType: fields.actorType,
    actorUid: fields.actorUid,
  };
  if (fields.actorUid) context.actorUidHash = shortHash(fields.actorUid);
  return Object.freeze(context);
}

function buildEntry(context, eventName, severity, extra) {
  const phase = deriveOperationalPhase(eventName, extra?.phase);
  const merged = {
    ...(context || {}),
    eventName,
    severity,
    ...(extra || {}),
    ...(phase ? { phase } : {}),
  };
  return redactSensitiveData(merged);
}

function logInfo(context, eventName, extra) {
  flogger.info(eventName, buildEntry(context, eventName, 'INFO', extra));
}
function logWarning(context, eventName, extra) {
  flogger.warn(eventName, buildEntry(context, eventName, 'WARNING', extra));
}
// Error logs retain stable code/retryability/trace metadata. internalMessage is
// always redacted because free text can accidentally contain identifiers or secrets.
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
  deriveOperationalPhase,
  redactSensitiveData,
  logInfo,
  logWarning,
  logError,
  measureDuration,
  shortHash,
  SENSITIVE_KEY_PATTERNS,
  SENSITIVE_IDENTITY_KEYS,
  OPERATIONAL_PHASES,
  REDACTED,
};