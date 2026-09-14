#!/usr/bin/env node
// @ts-check
// Runtime switch for mandatory driver updates.
// Deploy compatibility code first, publish the required Play build, then enable
// enforcement. Disabling remains available as an immediate rollback.

const admin = require('firebase-admin');
const { PROJECT_ENV } = require('../src/config/environment');
const {
  driverHasFreshSupportedBuild,
} = require('../src/drivers/appVersion');

const BUILD_PROOF_MAX_AGE_MS = 20 * 60 * 1000;

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

  let unsupportedDrivers = [];
  if (enforceMinimumDriverBuild) {
    const online = await admin.firestore()
      .collection('drivers')
      .where('availabilityStatus', '==', 'online')
      .get();
    const nowMs = Date.now();
    unsupportedDrivers = online.docs.filter((snapshot) => {
      const driver = snapshot.data() || {};
      if ((driver.serviceAreaId || 'HORIZONTE_CE_BR') !== serviceAreaId) return false;
      if (driver.activeRideId) return false;
      return !driverHasFreshSupportedBuild(
        driver,
        nowMs,
        BUILD_PROOF_MAX_AGE_MS,
        minimumBuildNumber
      );
    });
    if (unsupportedDrivers.length > 400) {
      die('more than 400 sessions require closure; refusing a partial activation');
    }
  }

  // One batch makes the policy activation and the idle-session purge atomic.
  // Active rides are deliberately excluded and finish under their current state.
  const batch = admin.firestore().batch();
  batch.set(ref, {
    minimumDriverBuildNumber,
    enforceMinimumDriverBuild,
    driverBuildPolicyUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  unsupportedDrivers.forEach((snapshot) => {
    batch.set(snapshot.ref, {
      availabilityStatus: 'offline',
      availabilitySessionId: null,
      availabilitySessionEndedAt: admin.firestore.FieldValue.serverTimestamp(),
      availabilityUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      locationAvailabilitySessionId: null,
      availabilityClientSessionId: null,
      availabilityClosedReason: 'mandatory_update_required',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();

  console.log(
    '[DRIVER_BUILD_POLICY] OK project=' + projectId
      + ' serviceArea=' + serviceAreaId
      + ' minimumBuild=' + minimumBuildNumber
      + ' enforced=' + enforceMinimumDriverBuild
      + ' sessionsClosed=' + unsupportedDrivers.length
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('[DRIVER_BUILD_POLICY] FAILED: ' + error.message);
  process.exit(1);
});
