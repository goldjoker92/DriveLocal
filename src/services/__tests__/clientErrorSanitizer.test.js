import {
  buildClientErrorPayload,
  clientErrorFingerprint,
  redactClientText,
  sanitizeClientErrorContext,
  shortClientId,
} from '../clientErrorSanitizer';

describe('client error sanitizer', () => {
  it('redacts PII, signed query strings and coordinates from free text', () => {
    const value = redactClientText(
      'email=person@example.com cpf=123.456.789-00 telefone=(85) 99999-1234 '
      + 'token=super-secret point=-4.123456,-38.987654 '
      + 'url=https://example.com/file?signature=abc123'
    );

    expect(value).not.toContain('person@example.com');
    expect(value).not.toContain('123.456.789-00');
    expect(value).not.toContain('99999-1234');
    expect(value).not.toContain('super-secret');
    expect(value).not.toContain('-4.123456');
    expect(value).not.toContain('signature=abc123');
    expect(value).toContain('[REDACTED');
  });

  it('shortens identifiers and strips route query strings', () => {
    const context = sanitizeClientErrorContext({
      route: '/active-ride?rideId=secret#payment',
      role: 'driver',
      rideId: 'ride_1234567890_abcdefghij',
      paymentId: 'payment_1234567890_abcdefghij',
      unknownSensitiveObject: { cpf: 'must-not-pass' },
    });

    expect(context.route).toBe('/active-ride');
    expect(context.rideRef).toBe('ride_1…ghij');
    expect(context.paymentRef).toBe('paymen…ghij');
    expect(context).not.toHaveProperty('unknownSensitiveObject');
  });

  it('builds a stable grouped payload without copying arbitrary context', () => {
    const error = new Error('Provider failed for person@example.com');
    error.stack = 'Error: Provider failed\n at RideScreen (https://app.local/main.js?token=abc:10:4)';

    const first = buildClientErrorPayload(error, {
      route: '/ride-request?raw=secret',
      role: 'passenger',
      source: 'react_boundary',
      isFatal: true,
      appVersion: '1.0.0',
      platform: 'android',
      environment: 'development',
      componentStack: 'at RideScreen cpf=123.456.789-00',
      rawPayload: { password: 'never' },
    }, 1_000);
    const second = buildClientErrorPayload(error, {
      route: '/ride-request',
      role: 'passenger',
      source: 'react_boundary',
      isFatal: true,
      appVersion: '1.0.0',
      platform: 'android',
      environment: 'development',
    }, 2_000);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.message).not.toContain('person@example.com');
    expect(first.stack).not.toContain('token=abc');
    expect(first.componentStack).not.toContain('123.456.789-00');
    expect(first).not.toHaveProperty('rawPayload');
    expect(first.occurredAtMs).toBe(1_000);
  });

  it('uses deterministic fingerprints and readable short references', () => {
    expect(clientErrorFingerprint(['Error', '/home'])).toBe(
      clientErrorFingerprint(['Error', '/home'])
    );
    expect(clientErrorFingerprint(['Error', '/home'])).not.toBe(
      clientErrorFingerprint(['Error', '/wallet'])
    );
    expect(shortClientId('short-id')).toBe('short-id');
  });
});
