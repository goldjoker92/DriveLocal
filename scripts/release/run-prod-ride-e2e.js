'use strict';

// Friendly preflight wrapper for the destructive/self-cleaning PROD ride E2E.
// The underlying test deliberately fails closed; this wrapper makes missing local
// configuration visible instead of returning to the prompt without explanation.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED = [
  'GOOGLE_SERVICES_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'ANDROID_APP_SIGNING_SHA1S',
  'PROD_RIDE_E2E_EMAIL_TEMPLATE',
  'PROD_RIDE_E2E_PASSWORD',
  'CONFIRM_PRODUCTION_RIDE_E2E',
];

function value(name) {
  return String(process.env[name] || '').trim();
}

function fail(lines) {
  console.error('[PROD_RIDE_E2E] BLOCKED');
  for (const line of lines) console.error(`  - ${line}`);
  console.error('\nConfigure les variables ci-dessus dans ce PowerShell, puis relance :');
  console.error('  npm run release:prod-ride-e2e');
  process.exit(1);
}

const errors = [];
for (const name of REQUIRED) {
  if (!value(name)) errors.push(`variable manquante : ${name}`);
}

if (value('CONFIRM_PRODUCTION_RIDE_E2E')
    && value('CONFIRM_PRODUCTION_RIDE_E2E') !== 'DRIVELOCAL_PRODUCTION') {
  errors.push('CONFIRM_PRODUCTION_RIDE_E2E doit valoir DRIVELOCAL_PRODUCTION');
}

if (value('PROD_RIDE_E2E_EMAIL_TEMPLATE')
    && !value('PROD_RIDE_E2E_EMAIL_TEMPLATE').includes('{{RUN_ID}}')) {
  errors.push('PROD_RIDE_E2E_EMAIL_TEMPLATE doit contenir {{RUN_ID}}');
}

if (value('PROD_RIDE_E2E_PASSWORD') && value('PROD_RIDE_E2E_PASSWORD').length < 12) {
  errors.push('PROD_RIDE_E2E_PASSWORD doit contenir au moins 12 caractères');
}

for (const name of ['GOOGLE_SERVICES_JSON', 'GOOGLE_APPLICATION_CREDENTIALS']) {
  const file = value(name);
  if (file && !fs.existsSync(file)) errors.push(`${name} : fichier introuvable (${file})`);
}

if (value('PROD_RIDE_E2E_REQUIRE_REAL_NOTIFICATIONS') === '1'
    && !value('PROD_RIDE_E2E_NOTIFICATION_SOURCE_UID')) {
  errors.push('PROD_RIDE_E2E_NOTIFICATION_SOURCE_UID est requis pour le mode notifications réelles');
}

if (errors.length) fail(errors);

console.log('[PROD_RIDE_E2E] preflight OK — lancement du test PROD');
const script = path.join(process.cwd(), 'functions', 'scripts', 'prod-ride-e2e-smoke.js');
const result = spawnSync(process.execPath, [script], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[PROD_RIDE_E2E] impossible de lancer le test : ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[PROD_RIDE_E2E] échec (code ${result.status ?? 'inconnu'})`);
  process.exit(result.status || 1);
}

console.log('[PROD_RIDE_E2E] wrapper terminé avec succès');
