#!/usr/bin/env node
// @ts-check
// Runtime switch for mandatory driver updates.
// Deploy compatibility code first, publish the required Play build, then enable
// enforcement. Disabling remains available as an immediate rollback.

const admin = require('firebase-admin');
const { PROJECT_ENV } = require('../src/config/environment');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function die(message) {
  console.error('[DRIVER_BUILD_POLICY] BLOCKED: ' + message);
  process.exit(1);
}

async function main() {
  const projectId = arg('project');
  const serviceAreaId = arg('service-area') || 'HORIZONTE_CE_BR';
  const minimumBuildNumber = Number(arg('build'));
  const enforceRaw = String(arg('enforce') || '').toLowerCase();
  const enforceMinimumDriverBuild = enforceRaw === 'true'
    ? true
    : enforceRaw === 'false'
      ? false
      : null;

  if (!projectId) die('missing --project <firebaseProjectId>');
  const environment = PROJECT_ENV[projectId];
  if (!environment) die('unknown project ' + projectId);
  if (!Number.isInteger(minimumBuildNumber) || minimumBuildNumber <= 0) {
    die('--build must be a positive integer');
  }
  if (enforceMinimumDriverBuild == null) {
    die('--enforce must be true or false');
  }
  if (
    environment === 'production'
    && process.env.CONFIRM_PRODUCTION_DEPLOY !== 'DRIVELOCAL_PRODUCTION'
  ) {
    die('production change requires CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION');
  }

  admin.initializeApp({ projectId });
  const ref = admin.firestore().collection('cityPublicConfig').doc(serviceAreaId);
  const current = await ref.get();
  if (!current.exists) die('service area config does not exist: ' + serviceAreaId);

  await ref.set({
    minimumDriverBuildNumber,
    enforceMinimumDriverBuild,
    driverBuildPolicyUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(
    '[DRIVER_BUILD_POLICY] OK project=' + projectId
      + ' serviceArea=' + serviceAreaId
      + ' minimumBuild=' + minimumBuildNumber
      + ' enforced=' + enforceMinimumDriverBuild
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('[DRIVER_BUILD_POLICY] FAILED: ' + error.message);
  process.exit(1);
});
