#!/usr/bin/env node
// @ts-check
// Idempotent service-area seed. Writes cityPublicConfig/{serviceAreaId} (active
// flag, operational polygon, identity metadata, versions) from the committed
// IBGE artifact. Safe to rerun: it MERGES config only and NEVER touches founder
// counters, pricing, drivers, rides, wallets or audit records.
//
// Fail closed: an explicit --project is REQUIRED and must match a known project;
// production requires CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION.
//
// Usage: node functions/scripts/seed-service-area.js --project drivelocal-dev [--service-area HORIZONTE_CE_BR]

const admin = require('firebase-admin');
const { loadBoundaryArtifact, validateBoundaryArtifact } = require('../src/geo/boundaryArtifact');
const { getServiceAreaIdentity } = require('../src/config/serviceAreaIdentity');
const { buildServiceAreaConfig } = require('../src/config/serviceAreaConfig');
const { PROJECT_ENV } = require('../src/config/environment');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function die(msg) { console.error(`[SEED] BLOCKED: ${msg}`); process.exit(1); }

async function main() {
  const projectId = arg('project');
  const serviceAreaId = arg('service-area', 'HORIZONTE_CE_BR');
  if (!projectId) die('missing --project <firebaseProjectId>');
  const env = PROJECT_ENV[projectId];
  if (!env) die(`unknown project "${projectId}" (refusing to seed an unmapped project)`);
  if (env === 'production' && process.env.CONFIRM_PRODUCTION_DEPLOY !== 'DRIVELOCAL_PRODUCTION') {
    die('production seed requires CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION');
  }

  const identity = getServiceAreaIdentity(serviceAreaId);
  if (!identity) die(`no canonical identity for ${serviceAreaId}`);

  const artifact = loadBoundaryArtifact(serviceAreaId);
  const report = validateBoundaryArtifact(artifact); // throws on any structural problem
  if (artifact.properties.municipalityCode !== identity.municipalityCode) {
    die('artifact municipalityCode does not match canonical identity');
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const ref = db.collection('cityPublicConfig').doc(serviceAreaId);
  const existing = (await ref.get()).data() || {};

  // MERGE config only. Never reset counters/pricing/operational data.
  const config = {
    ...buildServiceAreaConfig(identity, artifact, report, existing),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(config, { merge: true });
  console.log(`[SEED] ${env} project=${projectId} serviceArea=${serviceAreaId} ` +
    `boundaryVersion=${identity.boundaryVersion} coords=${report.coordinateCount} ` +
    `checksum=${report.checksum.slice(0, 12)}… OK (merge; counters/pricing preserved)`);
  process.exit(0);
}

main().catch((e) => { console.error(`[SEED] FAILED: ${e.message}`); process.exit(1); });
