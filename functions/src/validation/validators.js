// @ts-check
// Small, explicit boundary validators. Each throws a stable INVALID_ARGUMENT
// AppError and NEVER mutates the input. Deliberately NOT a generic validation
// framework — small functions that are easy to read and debug.

const { AppError, ERROR_CODES } = require('../errors/appError');

function fail(message, safeMetadata) {
  throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: message, safeMetadata });
}

function requireObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('payload must be a plain object');
  }
  return payload;
}

/**
 * Asserts a payload's shape. Rejects missing required fields and — for
 * sensitive/financial payloads (rejectUnknown, the default) — any unknown field.
 * Does not mutate the payload.
 * @param {object} payload
 * @param {{required?:string[], optional?:string[], rejectUnknown?:boolean}} [spec]
 */
function assertShape(payload, spec = {}) {
  const { required = [], optional = [], rejectUnknown = true } = spec;
  requireObject(payload);
  for (const key of required) {
    if (payload[key] === undefined || payload[key] === null) {
      fail(`missing required field: ${key}`, { field: key });
    }
  }
  if (rejectUnknown) {
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) fail(`unknown field: ${key}`, { field: key });
    }
  }
  return payload;
}

function validateNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(`invalid string: ${field}`, { field });
  return value;
}

// Identifier: non-empty string, no slash, bounded length (safe Firestore id / ref).
function validateIdentifier(value, field) {
  validateNonEmptyString(value, field);
  if (value.length > 512 || value.includes('/')) fail(`malformed identifier: ${field}`, { field });
  return value;
}

function validateEnum(value, allowedValues, field) {
  if (!Array.isArray(allowedValues) || !allowedValues.includes(value)) {
    fail(`invalid enum value: ${field}`, { field });
  }
  return value;
}

// Positive integer centavos: integer, finite, > 0. Rejects NaN/Infinity/floats/negatives.
function validatePositiveCentavos(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    fail(`invalid centavos (positive integer required): ${field}`, { field });
  }
  return value;
}

// Non-negative integer centavos: integer, finite, >= 0.
function validateNonNegativeCentavos(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    fail(`invalid centavos (non-negative integer required): ${field}`, { field });
  }
  return value;
}

// Epoch-ms timestamp: finite non-negative integer.
function validateTimestampMs(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    fail(`invalid timestamp (epoch ms): ${field}`, { field });
  }
  return value;
}

// Idempotency key: identifier-shaped, 8..200 chars.
function validateIdempotencyKey(value, field = 'idempotencyKey') {
  validateIdentifier(value, field);
  if (value.length < 8 || value.length > 200) fail(`invalid idempotency key length: ${field}`, { field });
  return value;
}

module.exports = {
  requireObject,
  assertShape,
  validateNonEmptyString,
  validateIdentifier,
  validateEnum,
  validatePositiveCentavos,
  validateNonNegativeCentavos,
  validateTimestampMs,
  validateIdempotencyKey,
};
