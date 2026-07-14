const { AppError, ERROR_CODES } = require('../errors/appError');

describe('AppError', () => {
  it('exposes a stable code, safe PT-BR message, and callable status', () => {
    const e = new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: 'debug detail' });
    expect(e.code).toBe('INVALID_ARGUMENT');
    expect(e.clientMessage).toBe('Dados inválidos. Verifique e tente novamente.');
    expect(e.callableStatus).toBe('invalid-argument');
  });

  it('does not expose internal cause or stack in the client payload', () => {
    const cause = new Error('sensitive internal detail');
    const e = new AppError(ERROR_CODES.INTERNAL_ERROR, { internalMessage: 'boom', cause });
    const client = e.toClient();
    expect(client).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String), retryable: false });
    expect(JSON.stringify(client)).not.toContain('sensitive internal detail');
    expect(client.stack).toBeUndefined();
    expect(client.internalCause).toBeUndefined();
    expect(e.internalCause).toBe(cause); // retained internally only
  });

  it('maps an unknown code to INTERNAL_ERROR', () => {
    const e = new AppError('NOT_A_REAL_CODE');
    expect(e.code).toBe('INTERNAL_ERROR');
  });

  it('marks provider errors retryable by default', () => {
    expect(new AppError(ERROR_CODES.PROVIDER_TIMEOUT).retryable).toBe(true);
    expect(new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE).retryable).toBe(true);
    expect(new AppError(ERROR_CODES.INVALID_ARGUMENT).retryable).toBe(false);
  });

  it('AppError.from wraps an unknown error as INTERNAL_ERROR retaining the cause', () => {
    const original = new Error('raw failure');
    const e = AppError.from(original);
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.internalCause).toBe(original);
    expect(e.toClient().message).not.toContain('raw failure');
  });

  it('AppError.from passes an existing AppError through unchanged', () => {
    const original = new AppError(ERROR_CODES.FORBIDDEN);
    expect(AppError.from(original)).toBe(original);
  });
});
