const { resolveEnvironment, ENVIRONMENTS } = require('../config/environment');
const { getMercadoPagoSecretNames, SECRET_NAMES } = require('../config/secrets');

describe('resolveEnvironment (explicit, fail-closed)', () => {
  it('detects the emulator from FIRESTORE_EMULATOR_HOST', () => {
    expect(resolveEnvironment({ env: {}, firestoreEmulatorHost: 'localhost:8080' })).toBe(
      ENVIRONMENTS.EMULATOR
    );
  });
  it('maps the dev project id to development', () => {
    expect(resolveEnvironment({ env: {}, projectId: 'drivelocal-dev' })).toBe(ENVIRONMENTS.DEVELOPMENT);
  });
  it('maps the prod project id to production', () => {
    expect(resolveEnvironment({ env: {}, projectId: 'drivelocal-prod' })).toBe(ENVIRONMENTS.PRODUCTION);
  });
  it('throws CONFIGURATION_MISSING for an unknown project id (never defaults to production)', () => {
    expect(() => resolveEnvironment({ env: {}, projectId: 'some-random-project' })).toThrow(
      /Unknown project id/
    );
  });
  it('throws when neither project id nor emulator is available', () => {
    expect(() => resolveEnvironment({ env: {} })).toThrow(/cannot resolve environment/);
  });
  it('throws when APP_ENV contradicts the project mapping', () => {
    expect(() =>
      resolveEnvironment({ env: {}, projectId: 'drivelocal-dev', appEnv: 'production' })
    ).toThrow(/contradicts/);
  });
});

describe('secret NAME selection (never values)', () => {
  it('selects TEST names for development/emulator', () => {
    const dev = getMercadoPagoSecretNames('development');
    expect(dev.accessToken).toBe(SECRET_NAMES.MERCADO_PAGO_ACCESS_TOKEN_TEST);
    expect(dev.webhookSecret).toBe(SECRET_NAMES.MERCADO_PAGO_WEBHOOK_SECRET_TEST);
  });
  it('selects PROD names for production', () => {
    const prod = getMercadoPagoSecretNames('production');
    expect(prod.accessToken).toBe(SECRET_NAMES.MERCADO_PAGO_ACCESS_TOKEN_PROD);
    expect(prod.webhookSecret).toBe(SECRET_NAMES.MERCADO_PAGO_WEBHOOK_SECRET_PROD);
  });
  it('returns only NAMES, not secret values (names equal their own key)', () => {
    Object.entries(SECRET_NAMES).forEach(([k, v]) => expect(v).toBe(k));
  });
});
