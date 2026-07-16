#!/usr/bin/env node
// @ts-check
// Fail-fast, NON-MUTATING configuration validator. Verifies the deployment
// target and Horizonte identity before any deploy/seed. Prints ONLY safe
// metadata — never secret values. Exit non-zero on any inconsistency.
//
// Usage:
//   node functions/scripts/validate-config.js --project drivelocal-dev --expect-env development
//   node functions/scripts/validate-config.js --project <prod> --expect-env production   (non-mutating check only)

const { PROJECT_ENV } = require('../src/config/environment');
const { getServiceAreaIdentity, DEFAULT_SERVICE_AREA_ID } = require('../src/config/serviceAreaIdentity');
const { loadBoundaryArtifact, validateBoundaryArtifact } = require('../src/geo/boundaryArtifact');

// Backend secret NAMES expected in Secret Manager (existence/metadata only — the
// values are never read, printed or copied here).
const EXPECTED_SECRET_NAMES = ['ROUTING_PROVIDER_API_KEY', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_WEBHOOK_SECRET'];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const problems = [];
function check(cond, msg) { if (!cond) problems.push(msg); }

function main() {
  const projectId = arg('project');
  const expectEnv = arg('expect-env');
  const serviceAreaId = arg('service-area', DEFAULT_SERVICE_AREA_ID);

  check(!!projectId, 'missing --project');
  const env = projectId ? PROJECT_ENV[projectId] : null;
  check(!!env, `unknown/unexpected project id "${projectId}" (not in the known project map)`);
  check(!expectEnv || env === expectEnv, `project "${projectId}" resolves to "${env}", expected "${expectEnv}"`);
  // dev and prod must never be the same project.
  check(PROJECT_ENV['drivelocal-dev'] !== PROJECT_ENV['drivelocal-prod'] || !('drivelocal-prod' in PROJECT_ENV),
    'dev and prod map to the same environment');

  const identity = getServiceAreaIdentity(serviceAreaId);
  check(!!identity, `no canonical identity for ${serviceAreaId}`);
  if (identity) {
    check(identity.municipalityCode === '2305233', 'Horizonte municipalityCode must be 2305233');
    try {
      const artifact = loadBoundaryArtifact(serviceAreaId);
      const report = validateBoundaryArtifact(artifact);
      check(artifact.properties.municipalityCode === identity.municipalityCode, 'artifact municipalityCode mismatch');
      check(artifact.properties.boundaryVersion === identity.boundaryVersion, 'artifact boundaryVersion mismatch');
      console.log(`[CONFIG] geometry=${report.geometryType} coords=${report.coordinateCount} checksum=${report.checksum.slice(0, 12)}…`);
    } catch (e) {
      problems.push(`boundary artifact invalid/missing: ${e.message}`);
    }
  }

  const isProd = env === 'production';
  if (isProd && process.env.CONFIRM_PRODUCTION_DEPLOY !== 'DRIVELOCAL_PRODUCTION') {
    // Non-mutating validation is allowed for prod; MUTATION is what is gated.
    console.log('[CONFIG] production target: mutations require CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION');
  }

  console.log('[CONFIG] safe summary:', JSON.stringify({
    environment: env || null,
    projectId: projectId || null,
    serviceAreaId,
    municipalityCode: identity ? identity.municipalityCode : null,
    region: 'southamerica-east1',
    boundaryVersion: identity ? identity.boundaryVersion : null,
    // Presence is asserted by deploy/CI via `firebase functions:secrets:access`
    // out-of-band; here we only list the NAMES the backend expects.
    requiredSecretNames: EXPECTED_SECRET_NAMES,
  }));

  if (problems.length) {
    console.error('[CONFIG] FAILED:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  console.log('[CONFIG] OK');
}

main();
