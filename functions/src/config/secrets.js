// @ts-check
// Secret NAMES only — never values. Real secret values live exclusively in
// Firebase Secret Manager and are injected at runtime. This module never reads,
// prints, logs, or commits a secret value.

const SECRET_NAMES = Object.freeze({
  MERCADO_PAGO_ACCESS_TOKEN_TEST: 'MERCADO_PAGO_ACCESS_TOKEN_TEST',
  MERCADO_PAGO_WEBHOOK_SECRET_TEST: 'MERCADO_PAGO_WEBHOOK_SECRET_TEST',
  MERCADO_PAGO_ACCESS_TOKEN_PROD: 'MERCADO_PAGO_ACCESS_TOKEN_PROD',
  MERCADO_PAGO_WEBHOOK_SECRET_PROD: 'MERCADO_PAGO_WEBHOOK_SECRET_PROD',
});

// Returns the Mercado Pago secret NAMES appropriate for an environment.
// development/emulator -> TEST names; production -> PROD names.
// Never returns values.
function getMercadoPagoSecretNames(environment) {
  if (environment === 'production') {
    return {
      accessToken: SECRET_NAMES.MERCADO_PAGO_ACCESS_TOKEN_PROD,
      webhookSecret: SECRET_NAMES.MERCADO_PAGO_WEBHOOK_SECRET_PROD,
    };
  }
  return {
    accessToken: SECRET_NAMES.MERCADO_PAGO_ACCESS_TOKEN_TEST,
    webhookSecret: SECRET_NAMES.MERCADO_PAGO_WEBHOOK_SECRET_TEST,
  };
}

module.exports = { SECRET_NAMES, getMercadoPagoSecretNames };
