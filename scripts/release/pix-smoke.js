#!/usr/bin/env node
// @ts-check
// NON-MUTATING Pix readiness audit.
//
// Reads approved driver profiles and their server-only Pix mirror, validates the
// key structure, and reports rollout readiness without printing any Pix key.
//
// Usage:
//   node scripts/release/pix-smoke.js --project drivelocal-prod
//
// Requires application default credentials with Firestore read access:
//   gcloud auth application-default login

const path = require('path');
const C = require('../../functions/src/rides/constants');
const { normalizePixKey } = require('../../functions/src/pix/pixKey');

function requireAdminSdk() {
  try {
    return require('firebase-admin');
  } catch (_rootError) {
    try {
      return require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
    } catch (_functionsError) {
      console.error(
        'firebase-admin not found. Install backend dependencies first:\n'
        + '  cd functions && npm install'
      );
      process.exit(1);
    }
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function classifyPixRecord(driverId, driver = {}, privateData = {}) {
  const publicPix = normalizePixKey(driver.pixKey, driver.pixKeyType);
  const privatePix = normalizePixKey(privateData.pixKey, privateData.pixKeyType);

  if (!publicPix.valid) {
    return {
      driverId,
      status: 'needs_driver_update',
      reasonCode: publicPix.reasonCode,
      privateKeyValid: privatePix.valid,
    };
  }

  const privateInSync = privatePix.valid
    && privatePix.key === publicPix.key
    && privatePix.keyType === publicPix.keyType;

  return {
    driverId,
    status: privateInSync ? 'ready' : 'sync_on_finish',
    reasonCode: privateInSync ? null : (privatePix.reasonCode || 'PIX_KEY_MISMATCH'),
    privateKeyValid: privatePix.valid,
  };
}

function summarizePixRecords(records) {
  return records.reduce((summary, record) => {
    summary.total += 1;
    summary[record.status] += 1;
    if (record.status === 'needs_driver_update') {
      const reason = record.reasonCode || 'PIX_KEY_INVALID';
      summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
    }
    return summary;
  }, {
    total: 0,
    ready: 0,
    sync_on_finish: 0,
    needs_driver_update: 0,
    reasons: {},
  });
}

async function loadPrivateDriverData(db, driverDocs) {
  const byId = new Map();
  const chunkSize = 200;
  for (let index = 0; index < driverDocs.length; index += chunkSize) {
    const chunk = driverDocs.slice(index, index + chunkSize);
    const refs = chunk.map((doc) => db.collection(C.PRIVATE_DRIVER_DATA).doc(doc.id));
    const snapshots = refs.length > 0 ? await db.getAll(...refs) : [];
    snapshots.forEach((snapshot) => {
      byId.set(snapshot.id, snapshot.exists ? (snapshot.data() || {}) : {});
    });
  }
  return byId;
}

async function main() {
  const projectId = arg('project');
  if (!projectId) {
    console.error('missing --project');
    process.exit(1);
  }

  const admin = requireAdminSdk();
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const driversSnap = await db
    .collection(C.DRIVERS)
    .where('verificationStatus', '==', 'approved')
    .get();
  const driverDocs = driversSnap.docs;
  const privateById = await loadPrivateDriverData(db, driverDocs);
  const records = driverDocs.map((doc) => classifyPixRecord(
    doc.id,
    doc.data() || {},
    privateById.get(doc.id) || {}
  ));
  const summary = summarizePixRecords(records);

  console.log(`\nPix smoke — ${projectId}\n`);
  console.log(`  approved drivers:       ${summary.total}`);
  console.log(`  ready:                  ${summary.ready}`);
  console.log(`  auto-sync before QR:    ${summary.sync_on_finish}`);
  console.log(`  profile update needed:  ${summary.needs_driver_update}`);

  if (summary.needs_driver_update > 0) {
    console.log('\n  invalid/missing public keys:');
    Object.entries(summary.reasons)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => console.log(`    ${reason.padEnd(28)} ${count}`));
    console.log('\n  driver accounts to contact (UID prefix only):');
    records
      .filter((record) => record.status === 'needs_driver_update')
      .forEach((record) => console.log(`    ${String(record.driverId).slice(0, 12)}  ${record.reasonCode}`));
  }

  if (summary.sync_on_finish > 0) {
    console.log(
      `\n[ WARN ] ${summary.sync_on_finish} valid profile key(s) need the new Functions sync before QR generation.`
    );
  }
  if (summary.needs_driver_update > 0) {
    console.log(
      `[ FAIL ] ${summary.needs_driver_update} driver(s) must save a valid, active Pix key in the profile.`
    );
  } else {
    console.log('[  OK  ] every approved driver has a structurally valid public Pix key.');
  }
  console.log('\nNo Pix key was printed and no Firestore document was changed.\n');
  process.exit(summary.needs_driver_update > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`pix smoke failed: ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  classifyPixRecord,
  summarizePixRecords,
};
