#!/usr/bin/env node
// @ts-check
// Read-only audit of approved driver Pix keys. Values are always redacted.

const admin = require('firebase-admin');
const { PROJECT_ENV } = require('../src/config/environment');
const { validateAndNormalizePixKey } = require('../src/pix/pixKey');

function arg(name) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function mask(value) {
  const text = String(value || '');
  if (text.length <= 4) return '****';
  return text.slice(0, 2) + '***' + text.slice(-2);
}

async function main() {
  const projectId = arg('project');
  if (!projectId || !PROJECT_ENV[projectId]) {
    throw new Error('use --project drivelocal-dev or --project drivelocal-prod');
  }

  admin.initializeApp({ projectId });
  const snapshot = await admin.firestore()
    .collection('drivers')
    .where('verificationStatus', '==', 'approved')
    .get();

  let valid = 0;
  const invalid = [];
  snapshot.forEach((document) => {
    const driver = document.data() || {};
    const result = validateAndNormalizePixKey(driver.pixKey, driver.pixKeyType);
    if (result.valid) {
      valid += 1;
      return;
    }
    invalid.push({
      driverId: document.id,
      name: String(driver.fullName || 'Sem nome').slice(0, 80),
      type: String(driver.pixKeyType || 'não informado').slice(0, 30),
      key: mask(driver.pixKey),
      reason: result.reason,
    });
  });

  console.log('[PIX_KEY_AUDIT] project=' + projectId
    + ' approved=' + snapshot.size
    + ' valid=' + valid
    + ' invalid=' + invalid.length);
  invalid.forEach((item) => {
    console.log('[INVALID] ' + item.driverId
      + ' | ' + item.name
      + ' | type=' + item.type
      + ' | key=' + item.key
      + ' | reason=' + item.reason);
  });

  process.exitCode = invalid.length > 0 ? 2 : 0;
}

main().catch((error) => {
  console.error('[PIX_KEY_AUDIT] FAILED: ' + error.message);
  process.exit(1);
});
