#!/usr/bin/env node
// @ts-check

// Non-mutating live parity check for the canonical DriveLocal configuration.
//
// It verifies that drivelocal-dev and drivelocal-prod contain the same structural
// service-area configuration generated from the committed source of truth. It
// deliberately does NOT compare or copy users, drivers, rides, wallets, Pix data,
// founder counters, audit records or any other operational data.
//
// Requires Application Default Credentials with read access to both projects.
// Usage:
//   node functions/scripts/verify-service-area-parity.js

const admin = require('firebase-admin');
const { loadBoundaryArtifact, validateBoundaryArtifact } = require('../src/geo/boundaryArtifact');
const {
  getServiceAreaIdentity,
  DEFAULT_SERVICE_AREA_ID,
} = require('../src/config/serviceAreaIdentity');
const { buildServiceAreaConfig } = require('../src/config/serviceAreaConfig');

const PROJECTS = Object.freeze([
  { projectId: 'drivelocal-dev', appName: 'drivelocal-parity-dev' },
  { projectId: 'drivelocal-prod', appName: 'drivelocal-parity-prod' },
]);

function normalize(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((output, key) => {
        output[key] = normalize(value[key]);
        return output;
      }, {});
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function canonicalConfig(serviceAreaId) {
  const identity = getServiceAreaIdentity(serviceAreaId);
  if (!identity) throw new Error(`Unknown service area ${serviceAreaId}.`);
  const artifact = loadBoundaryArtifact(serviceAreaId);
  const report = validateBoundaryArtifact(artifact);
  return buildServiceAreaConfig(identity, artifact, report, {
    allowedVehicleTypes: ['moto', 'car'],
  });
}

async function readProjectConfig({ projectId, appName }, serviceAreaId) {
  const app = admin.initializeApp(
    {
      credential: admin.credential.applicationDefault(),
      projectId,
    },
    appName
  );
  const snapshot = await app
    .firestore()
    .collection('cityPublicConfig')
    .doc(serviceAreaId)
    .get();

  if (!snapshot.exists) {
    throw new Error(`${projectId} is missing cityPublicConfig/${serviceAreaId}.`);
  }
  return snapshot.data() || {};
}

function compareCanonicalFields(projectId, actual, expected) {
  const mismatches = [];
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (!sameValue(actual[field], expectedValue)) mismatches.push(field);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `${projectId} differs from the canonical configuration in: ${mismatches.join(', ')}.`
    );
  }
  return Object.keys(expected).length;
}

async function main() {
  const serviceAreaId = DEFAULT_SERVICE_AREA_ID;
  const expected = canonicalConfig(serviceAreaId);
  const loaded = [];

  for (const project of PROJECTS) {
    const actual = await readProjectConfig(project, serviceAreaId);
    const checkedFields = compareCanonicalFields(project.projectId, actual, expected);
    loaded.push({ projectId: project.projectId, actual, checkedFields });
    console.log(
      `[FIREBASE_PARITY] OK project=${project.projectId} serviceArea=${serviceAreaId} `
        + `checkedFields=${checkedFields}`
    );
  }

  const [development, production] = loaded;
  const crossProjectMismatches = Object.keys(expected).filter(
    (field) => !sameValue(development.actual[field], production.actual[field])
  );
  if (crossProjectMismatches.length > 0) {
    throw new Error(
      `DEV and PROD differ in canonical fields: ${crossProjectMismatches.join(', ')}.`
    );
  }

  console.log(
    `[FIREBASE_PARITY] GREEN dev=drivelocal-dev prod=drivelocal-prod `
      + `serviceArea=${serviceAreaId} operationalDataCompared=false`
  );
}

main().catch((error) => {
  console.error(`[FIREBASE_PARITY] BLOCKED: ${error?.message || 'unknown_error'}`);
  process.exitCode = 1;
});

module.exports = {
  PROJECTS,
  normalize,
  sameValue,
  canonicalConfig,
  compareCanonicalFields,
};
