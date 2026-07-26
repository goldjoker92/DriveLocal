// Pure client-side crash-report sanitization.
//
// This module deliberately has no Firebase, React Native or Expo imports so it
// can be tested in isolation. Reports are allow-listed rather than copying an
// arbitrary context object: unknown fields are discarded by design.

const MAX_MESSAGE_LENGTH = 320;
const MAX_STACK_LENGTH = 4000;
const MAX_COMPONENT_STACK_LENGTH = 2400;
const MAX_ROUTE_LENGTH = 160;

const ROLE_VALUES = new Set(['driver', 'passenger', 'admin', 'anonymous', 'unknown']);
const SEVERITY_VALUES = new Set(['fatal', 'error', 'warning']);
const SOURCE_VALUES = new Set(['react_boundary', 'javascript_global', 'non_fatal']);
const PLATFORM_VALUES = new Set(['android', 'ios', 'web', 'unknown']);
const ENVIRONMENT_VALUES = new Set(['development', 'production']);

function boundedText(value, maxLength) {
  return String(value == null ? '' : value).slice(0, maxLength);
}

export function redactClientText(value, maxLength = MAX_MESSAGE_LENGTH) {
  let text = boundedText(value, maxLength * 2);

  // Remove URL query strings because signed URLs and tokens commonly live there.
  text = text.replace(/(https?:\/\/[^\s?#]+)(?:\?[^\s#]*)?(?:#[^\s]*)?/gi, '$1?[REDACTED]');
  // Email, CPF-like numbers, Brazilian phone-like numbers and coordinate pairs.
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  text = text.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[REDACTED_CPF]');
  text = text.replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[REDACTED_PHONE]');
  text = text.replace(/-?\d{1,2}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, '[REDACTED_COORDINATES]');
  // Common key/value fragments that may be interpolated inside provider errors.
  text = text.replace(/\b(?:cpf|cnpj|cnh|phone|telefone|email|pix(?:key|_key)?|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_FIELD]');

  return boundedText(text, maxLength);
}

export function shortClientId(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (text.length <= 12) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export function sanitizeClientRoute(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const pathOnly = text.split(/[?#]/, 1)[0];
  return boundedText(pathOnly || '/', MAX_ROUTE_LENGTH);
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

// Small deterministic hash used only for duplicate grouping. It is not a
// credential or security primitive, and no raw identifier is included in it.
export function clientErrorFingerprint(parts) {
  const input = Array.isArray(parts) ? parts.join('|') : String(parts || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `cef_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizeClientError(error) {
  if (error instanceof Error) {
    return {
      errorName: boundedText(error.name || 'Error', 80),
      message: redactClientText(error.message || 'Unknown error', MAX_MESSAGE_LENGTH),
      stack: redactClientText(error.stack || '', MAX_STACK_LENGTH) || null,
    };
  }

  return {
    errorName: 'NonErrorThrow',
    message: redactClientText(error || 'Unknown error', MAX_MESSAGE_LENGTH),
    stack: null,
  };
}

export function sanitizeClientErrorContext(context = {}) {
  return {
    eventName: boundedText(context.eventName || 'client.error', 100),
    severity: enumValue(context.severity, SEVERITY_VALUES, context.isFatal ? 'fatal' : 'error'),
    source: enumValue(context.source, SOURCE_VALUES, 'non_fatal'),
    isFatal: context.isFatal === true,
    route: sanitizeClientRoute(context.route),
    role: enumValue(context.role, ROLE_VALUES, 'unknown'),
    rideRef: shortClientId(context.rideId || context.rideRef),
    paymentRef: shortClientId(context.paymentId || context.paymentRef),
    traceRef: shortClientId(context.traceId || context.traceRef),
    appVersion: boundedText(context.appVersion || 'unknown', 40),
    environment: enumValue(context.environment, ENVIRONMENT_VALUES, 'production'),
    platform: enumValue(context.platform, PLATFORM_VALUES, 'unknown'),
    componentStack: redactClientText(context.componentStack || '', MAX_COMPONENT_STACK_LENGTH) || null,
  };
}

export function buildClientErrorPayload(error, context = {}, nowMs = Date.now()) {
  const normalizedError = normalizeClientError(error);
  const safeContext = sanitizeClientErrorContext(context);
  const firstStackLine = normalizedError.stack ? normalizedError.stack.split('\n')[0] : '';
  const fingerprint = clientErrorFingerprint([
    normalizedError.errorName,
    normalizedError.message,
    safeContext.route,
    firstStackLine,
    safeContext.appVersion,
  ]);

  return Object.freeze({
    ...safeContext,
    ...normalizedError,
    fingerprint,
    occurredAtMs: Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now(),
  });
}

export const CLIENT_ERROR_LIMITS = Object.freeze({
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  MAX_COMPONENT_STACK_LENGTH,
  MAX_ROUTE_LENGTH,
});
