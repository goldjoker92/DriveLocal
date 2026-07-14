const { healthHandler } = require('../diagnostics/healthHandler');
const { withCallableBoundary } = require('../errors/boundary');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { fixedClock } = require('../time/clock');

describe('diagnostic healthHandler', () => {
  it('returns only safe fields in development, including the traceId', () => {
    const context = { traceId: 'trace_diag' };
    const out = healthHandler({}, context, { environment: 'development', clock: fixedClock(5000) });
    expect(out).toEqual({
      status: 'ok',
      environment: 'development',
      functionVersion: '02-functions-debug-foundation',
      serverTimeMs: 5000,
      serverTimeIso: new Date(5000).toISOString(),
      traceId: 'trace_diag',
    });
    // No secrets / env vars / config leaked.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/token|secret|password|process\.env|FIREBASE_/i);
  });

  it('is disabled in production by default', () => {
    expect(() =>
      healthHandler({}, { traceId: 't' }, { environment: 'production', clock: fixedClock(1) })
    ).toThrow(/disabled in production/);
  });
});

describe('callable error boundary', () => {
  it('maps an AppError to a safe HttpsError without leaking internals', async () => {
    const wrapped = withCallableBoundary('t', async () => {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: 'super secret detail' });
    });
    await expect(wrapped({ auth: null })).rejects.toMatchObject({
      code: 'invalid-argument',
      details: { code: 'INVALID_ARGUMENT' },
    });
    let caught;
    try {
      await wrapped({ auth: null });
    } catch (e) {
      caught = e;
    }
    expect(JSON.stringify(caught.details)).not.toContain('super secret detail');
  });

  it('maps an unknown error to INTERNAL_ERROR', async () => {
    const wrapped = withCallableBoundary('t', async () => {
      throw new Error('raw internal failure');
    });
    let caught;
    try {
      await wrapped({ auth: null });
    } catch (e) {
      caught = e;
    }
    expect(caught.code).toBe('internal');
    expect(caught.details.code).toBe('INTERNAL_ERROR');
    expect(caught.message).not.toContain('raw internal failure');
  });
});
