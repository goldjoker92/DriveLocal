const {
  REPORT_BUCKET_MS,
  normalizeClientErrorPayload,
  buildServerFingerprint,
  buildReportDocumentId,
  safeReference,
} = require('../reportPolicy');

describe('client error report policy', () => {
  it('redacts free text and discards invalid references', () => {
    const nowMs = 2_000_000;
    const report = normalizeClientErrorPayload({
      eventName: 'react.render_failed',
      severity: 'fatal',
      source: 'react_boundary',
      isFatal: true,
      errorName: 'TypeError',
      message: 'person@example.com cpf=123.456.789-00 token=abc',
      stack: 'at Screen https://example.com/main.js?secret=abc',
      componentStack: 'at Ride cpf=123.456.789-00',
      route: '/active-ride?rideId=raw',
      role: 'driver',
      rideRef: 'raw/full/identifier/not/allowed',
      paymentRef: 'paymen…1234',
      traceRef: 'ui_abc-123',
      appVersion: '1.0.0',
      environment: 'development',
      platform: 'android',
      occurredAtMs: nowMs,
      unknownField: { password: 'never' },
    }, nowMs);

    expect(report.message).not.toContain('person@example.com');
    expect(report.message).not.toContain('123.456.789-00');
    expect(report.message).not.toContain('token=abc');
    expect(report.stack).not.toContain('secret=abc');
    expect(report.componentStack).not.toContain('123.456.789-00');
    expect(report.route).toBe('/active-ride');
    expect(report.rideRef).toBeNull();
    expect(report.paymentRef).toBe('paymen…1234');
    expect(report.traceRef).toBe('ui_abc-123');
    expect(report).not.toHaveProperty('unknownField');
  });

  it('clamps forged timestamps to server time', () => {
    const nowMs = 10 * 24 * 60 * 60 * 1000;
    const report = normalizeClientErrorPayload({
      occurredAtMs: nowMs + 3 * 24 * 60 * 60 * 1000,
    }, nowMs);
    expect(report.occurredAtMs).toBe(nowMs);
  });

  it('groups the same crash deterministically within one ten-minute bucket', () => {
    const report = normalizeClientErrorPayload({
      errorName: 'TypeError',
      message: 'Cannot read property status',
      route: '/driver-home',
      appVersion: '1.0.0',
      stack: 'TypeError: Cannot read property status\n at DriverHome:42',
    }, 1_000);
    const fingerprint = buildServerFingerprint(report);

    const first = buildReportDocumentId({
      actorHash: 'abcdef123456',
      fingerprint,
      nowMs: REPORT_BUCKET_MS + 1,
    });
    const second = buildReportDocumentId({
      actorHash: 'abcdef123456',
      fingerprint,
      nowMs: REPORT_BUCKET_MS + 9_000,
    });
    const nextBucket = buildReportDocumentId({
      actorHash: 'abcdef123456',
      fingerprint,
      nowMs: 2 * REPORT_BUCKET_MS + 1,
    });

    expect(first).toBe(second);
    expect(nextBucket).not.toBe(first);
    expect(first).toContain(fingerprint);
  });

  it('accepts only short safe references', () => {
    expect(safeReference('ride_1…abcd')).toBe('ride_1…abcd');
    expect(safeReference('raw/reference/with/slashes')).toBeNull();
    expect(safeReference('x'.repeat(40))).toBeNull();
  });
});
