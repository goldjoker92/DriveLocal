const {
  createTraceId,
  createLoggerContext,
  redactSensitiveData,
  measureDuration,
  REDACTED,
} = require('../logging/logger');
const { fixedClock } = require('../time/clock');

describe('logger — traceId', () => {
  it('generates a prefixed, unique trace id', () => {
    const a = createTraceId();
    const b = createTraceId();
    expect(a).toMatch(/^trace_/);
    expect(a).not.toBe(b);
  });
  it('createLoggerContext carries a traceId and is frozen', () => {
    const ctx = createLoggerContext({ functionName: 'health' });
    expect(ctx.traceId).toMatch(/^trace_/);
    expect(Object.isFrozen(ctx)).toBe(true);
  });
});

describe('logger — recursive redaction', () => {
  it('redacts sensitive keys in nested objects and keeps safe metadata', () => {
    const input = {
      traceId: 'trace_1',
      driverId: 'd1',
      accessToken: 'FAKE-TEST-VALUE-should-not-appear',
      nested: { cpf: '123.456.789-00', vehicleType: 'moto' },
      pixKey: 'secret@pix',
    };
    const out = redactSensitiveData(input);
    expect(out.accessToken).toBe(REDACTED);
    expect(out.pixKey).toBe(REDACTED);
    expect(out.nested.cpf).toBe(REDACTED);
    expect(out.nested.vehicleType).toBe('moto'); // safe metadata retained
    expect(out.driverId).toBe(REDACTED); // raw account identity never reaches logs
    expect(out.traceId).toBe('trace_1');
  });
  it('redacts sensitive keys inside arrays', () => {
    const input = { items: [{ email: 'a@b.com', rideId: 'r1' }, { phone: '+55', rideId: 'r2' }] };
    const out = redactSensitiveData(input);
    expect(out.items[0].email).toBe(REDACTED);
    expect(out.items[0].rideId).toBe('r1');
    expect(out.items[1].phone).toBe(REDACTED);
    expect(out.items[1].rideId).toBe('r2');
  });
  it('does not mutate the input object', () => {
    const input = { accessToken: 'x', nested: { cpf: 'y' } };
    const snapshot = JSON.stringify(input);
    redactSensitiveData(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('logger — measureDuration', () => {
  it('measures duration using an injected clock', async () => {
    const clock = fixedClock(1000);
    const { result, durationMs } = await measureDuration(clock, async () => {
      clock.advance(42);
      return 'done';
    });
    expect(result).toBe('done');
    expect(durationMs).toBe(42);
  });
});
