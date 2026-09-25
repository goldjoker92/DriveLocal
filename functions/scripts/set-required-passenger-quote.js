#!/usr/bin/env node
// Operator switch for the legacy passenger callable. Deploy the dual-path
// backend first, publish the quote-enabled Android build, then require quotes.
// The false setting is an immediate rollback without changing ride history.
const admin = require('firebase-admin');
const { PROJECT_ENV } = require('../src/config/environment');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function die(message) {
  console.error('[PASSENGER_QUOTE_POLICY] BLOCKED: ' + message);
  process.exit(1);
}

async function main() {
  const projectId = arg('project');
  const serviceAreaId = arg('service-area') || 'HORIZONTE_CE_BR';
  const requested = arg('enforce');
  if (!projectId || !PROJECT_ENV[projectId]) die('missing or unknown --project');
  if (!/^[A-Z0-9_]{4,50}$/.test(serviceAreaId)) die('invalid --service-area');
  if (requested !== 'true' && requested !== 'false') die('--enforce must be true or false');
  if (PROJECT_ENV[projectId] === 'production'
    && process.env.CONFIRM_PRODUCTION_DEPLOY !== 'DRIVELOCAL_PRODUCTION') {
    die('production change requires CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION');
  }

  admin.initializeApp({ projectId });
  const ref = admin.firestore().collection('cityPublicConfig').doc(serviceAreaId);
  if (!(await ref.get()).exists) die('service area config does not exist: ' + serviceAreaId);
  await ref.set({
    requirePassengerQuote: requested === 'true',
    passengerQuotePolicyUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('[PASSENGER_QUOTE_POLICY] OK project=' + projectId
    + ' serviceArea=' + serviceAreaId + ' enforced=' + requested);
}

main().catch((error) => {
  console.error('[PASSENGER_QUOTE_POLICY] FAILED: ' + error.message);
  process.exitCode = 1;
});
