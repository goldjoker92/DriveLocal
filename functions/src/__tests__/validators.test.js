const {
  assertShape,
  validateIdentifier,
  validateEnum,
  validatePositiveCentavos,
  validateNonNegativeCentavos,
  validateIdempotencyKey,
} = require('../validation/validators');

describe('assertShape', () => {
  it('rejects missing required fields', () => {
    expect(() => assertShape({ a: 1 }, { required: ['a', 'b'] })).toThrow(/missing required field: b/);
  });
  it('rejects unknown fields for sensitive payloads', () => {
    expect(() => assertShape({ a: 1, evil: 2 }, { required: ['a'] })).toThrow(/unknown field: evil/);
  });
  it('accepts a valid shape and does not mutate the payload', () => {
    const payload = { a: 1, b: 2 };
    const snapshot = JSON.stringify(payload);
    const out = assertShape(payload, { required: ['a'], optional: ['b'] });
    expect(out).toBe(payload);
    expect(JSON.stringify(payload)).toBe(snapshot);
  });
});

describe('centavo validators', () => {
  it('accepts a positive integer', () => {
    expect(validatePositiveCentavos(905, 'fare')).toBe(905);
  });
  it('rejects zero, negative, float, NaN and Infinity', () => {
    expect(() => validatePositiveCentavos(0, 'fare')).toThrow(/invalid centavos/);
    expect(() => validatePositiveCentavos(-1, 'fare')).toThrow(/invalid centavos/);
    expect(() => validatePositiveCentavos(9.5, 'fare')).toThrow(/invalid centavos/);
    expect(() => validatePositiveCentavos(NaN, 'fare')).toThrow(/invalid centavos/);
    expect(() => validatePositiveCentavos(Infinity, 'fare')).toThrow(/invalid centavos/);
  });
  it('non-negative accepts 0 but rejects negatives and floats', () => {
    expect(validateNonNegativeCentavos(0, 'x')).toBe(0);
    expect(() => validateNonNegativeCentavos(-1, 'x')).toThrow();
    expect(() => validateNonNegativeCentavos(1.5, 'x')).toThrow();
  });
});

describe('identifiers, enums, idempotency keys', () => {
  it('rejects malformed identifiers', () => {
    expect(() => validateIdentifier('', 'id')).toThrow();
    expect(() => validateIdentifier('a/b', 'id')).toThrow(/malformed identifier/);
    expect(validateIdentifier('driver_123', 'id')).toBe('driver_123');
  });
  it('validates enums', () => {
    expect(validateEnum('moto', ['moto', 'car'], 'v')).toBe('moto');
    expect(() => validateEnum('boat', ['moto', 'car'], 'v')).toThrow(/invalid enum/);
  });
  it('validates idempotency key length and shape', () => {
    expect(() => validateIdempotencyKey('short', 'k')).toThrow();
    expect(validateIdempotencyKey('DL-TOPUP-000123', 'k')).toBe('DL-TOPUP-000123');
  });
});
