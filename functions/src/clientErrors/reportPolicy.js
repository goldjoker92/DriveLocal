// @ts-check
// Pure normalization and deduplication policy for client error reports.
// No Firebase imports: this module is deterministic and unit-testable.

const { createHash } = require('crypto');

const MAX_MESSAGE_LENGTH = 320;
const MAX_STACK_LENGTH = 4000;
const MAX_COMPONENT_STACK_LENGTH = 2400;
const MAX_ROUTE_LENGTH = 160;
const REPORT_BUCKET_MS = 10 * 60 * 1000;

const ALLOWED_SEVERITIES = new Set(['fatal', 'error', 'warning']);
const ALLOWED_SOURCES = new Set(['react_boundary', 'javascript_global', 'non_fatal']);
const ALLOWED_ROLES = new Set(['driver', 'passenger', 'admin', 'anonymous', 'unknown']);
const ALLOWED_PLATFORMS = new Set(['android', 'ios', 'web', 'unknown']);
const ALLOWED_ENVIRONMENTS = new Set(['development', 'production']);

function bounded(value, maxLength) {
  return String(value == null ? '' : value).slice(0, maxLength);
}

function redactFreeText(value, maxLength) {
  let text = bounded(value, maxLength * 2);
  text = text.replace(/(https?:\/\/[^\s?#]+)(?:\?[^\s#]*)?(?:#[^\s]*)?/gi, '$1?[REDACTED]');
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  text = text.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[REDACTED_CPF]');
  text = text.replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[REDACTED_PHONE]');
  text = text.replace(/-?\d{1,2}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, '[REDACTED_COORDINATES]');
  text = text.replace(/\b(?:cpf|cnpj|cnh|phone|telefone|email|pix(?:key|_key)?|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_FIELD]');
  return bounded(text, maxLength);
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function safeReference(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  // Client references are already shortened. Re-enforce a small safe alphabet and
  // length server-side so raw identifiers cannot be smuggled into the report.
  return /^[A-Za-z0-9_.:\-…]{1,32}$/.test(text) ? text : null;
}

function safeRoute(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  return bounded(text.split(/[?#]/, 1)[0] || '/', MAX_ROUTE_LENGTH);
}

function safeEventName(value) {
  const text = String(value || 'client.error').trim();
  return /^[a-z0-9_.-]{1,100}$/i.test(text) ? text : 'client.error';
}

function safeOccurredAt(value, nowMs) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return nowMs;
  // Prevent arbitrary historical/future timestamps from polluting operational views.
  const maxSkewMs = 24 * 60 * 60 * 1000;
  return Math.abs(candidate - nowMs) <= maxSkewMs ? Math.trunc(candidate) : nowMs;
}

function normalizeClientErrorPayload(input = {}, nowMs = Date.now()) {
  const payload = input && typeof input === 'object' ? input : {};
  const normalized = {
    eventName: safeEventName(payload.eventName),
    severity: enumValue(payload.severity, ALLOWED_SEVERITIES, payload.isFatal === true ? 'fatal' : 'error'),
    source: enumValue(payload.source, ALLOWED_SOURCES, 'non_fatal'),
    isFatal: payload.isFatal === true,
    errorName: bounded(payload.errorName || 'Error', 80),
    message: redactFreeText(payload.message || 'Unknown error', MAX_MESSAGE_LENGTH),
    stack: redactFreeText(payload.stack || '', MAX_STACK_LENGTH) || null,
    componentStack: redactFreeText(payload.componentStack || '', MAX_COMPONENT_STACK_LENGTH) || null,
    route: safeRoute(payload.route),
    role: enumValue(payload.role, ALLOWED_ROLES, 'unknown'),
    rideRef: safeReference(payload.rideRef),
    paymentRef: safeReference(payload.paymentRef),
    traceRef: safeReference(payload.traceRef),
    appVersion: bounded(payload.appVersion || 'unknown', 40),
    environment: enumValue(payload.environment, ALLOWED_ENVIRONMENTS, 'production'),
    platform: enumValue(payload.platform, ALLOWED_PLATFORMS, 'unknown'),
    occurredAtMs: safeOccurredAt(payload.occurredAtMs, nowMs),
  };

  return Object.freeze(normalized);
}

function buildServerFingerprint(report) {
  const firstStackLine = report.stack ? report.stack.split('\n')[0] : '';
  return createHash('sha256')
    .update([
      report.errorName,
      report.message,
      report.route || '',
      firstStackLine,
      report.appVersion,
    ].join('|'))
    .digest('hex')
    .slice(0, 20);
}

function buildReportDocumentId({ actorHash, fingerprint, nowMs }) {
  const safeActorHash = String(actorHash || '').replace(/[^a-f0-9]/gi, '').slice(0, 20) || 'anonymous';
  const safeFingerprint = String(fingerprint || '').replace(/[^a-f0-9]/gi, '').slice(0, 24) || 'unknown';
  const bucket = Math.floor(Number(nowMs || 0) / REPORT_BUCKET_MS);
  return `cer_${safeActorHash}_${safeFingerprint}_${bucket}`;
}

module.exports = {
  REPORT_BUCKET_MS,
  normalizeClientErrorPayload,
  buildServerFingerprint,
  buildReportDocumentId,
  redactFreeText,
  safeReference,
};
