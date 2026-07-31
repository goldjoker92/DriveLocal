'use strict';

// Configures the Firebase Android API key and Android app registration in
// drivelocal-prod so every Google Play app-signing certificate accepted for
// DriveLocal can call Firebase services. Existing API target restrictions are
// preserved. A conflicting browser, iOS, or server client restriction causes a
// fail-closed error instead of an unsafe overwrite.

const {
  loadFirebaseBuildConfig,
  readGoogleServicesJson,
} = require('../build/firebaseBuildConfig');
const { getServiceAccountAccessToken } = require('./googleServiceAccountAuth');
const {
  normalizeSha1,
  parseSha1Fingerprints,
  parseExpectedSigningCertCount,
} = require('./prod-auth-smoke');

const REQUIRED_CONFIRMATION = 'DRIVELOCAL_PRODUCTION';
const EXPECTED_PROJECT_ID = 'drivelocal-prod';
const ANDROID_PACKAGE = 'com.drivelocal.app';
const API_KEYS_BASE_URL = 'https://apikeys.googleapis.com/v2';
const FIREBASE_MANAGEMENT_BASE_URL = 'https://firebase.googleapis.com/v1beta1';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch (_error) { body = { raw: text.slice(0, 240) }; }
  }

  if (!response.ok) {
    const reason = body?.error?.message || body?.error?.status || `HTTP_${response.status}`;
    throw new Error(String(reason).slice(0, 240));
  }

  return body;
}

async function authorizedRequest(url, accessToken, options = {}) {
  return readJsonResponse(await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  }));
}

function expectedAllowedApplications(fingerprints) {
  return fingerprints.map((sha1Fingerprint) => ({
    packageName: ANDROID_PACKAGE,
    sha1Fingerprint,
  }));
}

function applicationKey(application) {
  return `${application.packageName || ''}:${String(application.sha1Fingerprint || '')}`
    .replace(/:/g, '')
    .toUpperCase();
}

function assertNoConflictingClientRestriction(restrictions = {}) {
  const conflicts = [
    'browserKeyRestrictions',
    'serverKeyRestrictions',
    'iosKeyRestrictions',
  ].filter((field) => restrictions[field]);

  if (conflicts.length) {
    throw new Error(
      `refusing to replace conflicting API key restriction: ${conflicts.join(',')}`
    );
  }
}

function restrictionsWithAndroidApplications(currentRestrictions, applications) {
  const restrictions = { ...(currentRestrictions || {}) };
  assertNoConflictingClientRestriction(restrictions);
  restrictions.androidKeyRestrictions = { allowedApplications: applications };
  return restrictions;
}

async function waitForOperation(operation, accessToken) {
  let current = operation;
  const deadline = Date.now() + 120000;

  while (!current.done) {
    if (Date.now() >= deadline) throw new Error('API key update operation timed out');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    current = await authorizedRequest(`${API_KEYS_BASE_URL}/${current.name}`, accessToken);
  }

  if (current.error) {
    throw new Error(current.error.message || current.error.status || 'API key update failed');
  }

  return current.response || {};
}

function assertExactApplications(actualApplications, expectedApplications) {
  const actual = [...new Set((actualApplications || []).map(applicationKey))].sort();
  const expected = [...new Set(expectedApplications.map(applicationKey))].sort();

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `API key Android restrictions mismatch: expected ${expected.length}, received ${actual.length}`
    );
  }
}

function normalizedFirebaseSha1Set(certificates = []) {
  const values = [];
  for (const certificate of certificates) {
    if (certificate?.certType !== 'SHA_1' || !certificate?.shaHash) continue;
    try {
      values.push(normalizeSha1(certificate.shaHash));
    } catch (_error) {
      // Ignore malformed unrelated records and verify our required certificates below.
    }
  }
  return new Set(values);
}

async function ensureFirebaseAndroidShaCertificates({
  projectId,
  appId,
  fingerprints,
  accessToken,
}) {
  const parent = `projects/${projectId}/androidApps/${encodeURIComponent(appId)}`;
  const listUrl = `${FIREBASE_MANAGEMENT_BASE_URL}/${parent}/sha`;
  const existing = await authorizedRequest(listUrl, accessToken);
  const existingSha1s = normalizedFirebaseSha1Set(existing.certificates);

  for (const fingerprint of fingerprints) {
    if (existingSha1s.has(fingerprint)) continue;

    await authorizedRequest(listUrl, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        name: '',
        shaHash: fingerprint,
        certType: 'SHA_1',
      }),
    });
  }

  const verified = await authorizedRequest(listUrl, accessToken);
  const verifiedSha1s = normalizedFirebaseSha1Set(verified.certificates);
  const missing = fingerprints.filter((fingerprint) => !verifiedSha1s.has(fingerprint));

  if (missing.length) {
    throw new Error(`Firebase Android app is missing ${missing.length} Play SHA-1 certificates`);
  }

  return {
    registeredRequiredCount: fingerprints.length,
    totalFirebaseSha1Count: verifiedSha1s.size,
  };
}

async function main() {
  if (process.env.CONFIRM_PRODUCTION_API_KEY_CONFIG !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `production API key update requires CONFIRM_PRODUCTION_API_KEY_CONFIG=${REQUIRED_CONFIRMATION}`
    );
  }

  const fingerprints = parseSha1Fingerprints(required('ANDROID_APP_SIGNING_SHA1S'));
  const expectedCount = parseExpectedSigningCertCount(
    process.env.PROD_EXPECTED_SIGNING_CERT_COUNT
  );

  if (fingerprints.length !== expectedCount) {
    throw new Error(
      `expected ${expectedCount} unique Play signing SHA-1 fingerprints; received ${fingerprints.length}`
    );
  }

  const build = loadFirebaseBuildConfig({
    env: { ...process.env, APP_ENV: 'prod', EAS_BUILD: '1' },
    packageName: ANDROID_PACKAGE,
  });

  if (build.firebaseProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`refusing project ${build.firebaseProjectId}; expected ${EXPECTED_PROJECT_ID}`);
  }

  const { parsed: googleServices } = readGoogleServicesJson(build.googleServicesResolvedPath);
  const projectNumber = String(googleServices?.project_info?.project_number || '').trim();
  if (!/^\d+$/.test(projectNumber)) {
    throw new Error('google-services PROD is missing a valid project number');
  }

  const accessToken = await getServiceAccountAccessToken({
    expectedProjectId: EXPECTED_PROJECT_ID,
  });

  console.log(
    `[PROD_API_KEY] project=${EXPECTED_PROJECT_ID} package=${ANDROID_PACKAGE}`
    + ` signingCerts=${fingerprints.length} lookup started`
  );

  const apiKey = build.firebaseConfig.apiKey;
  const lookup = await authorizedRequest(
    `${API_KEYS_BASE_URL}/keys:lookupKey?keyString=${encodeURIComponent(apiKey)}`,
    accessToken
  );

  const expectedParent = `projects/${projectNumber}/locations/global`;
  if (lookup.parent !== expectedParent || !lookup.name?.startsWith(`${expectedParent}/keys/`)) {
    throw new Error('Firebase Android API key does not belong to drivelocal-prod');
  }

  const currentKey = await authorizedRequest(`${API_KEYS_BASE_URL}/${lookup.name}`, accessToken);
  const applications = expectedAllowedApplications(fingerprints);
  const restrictions = restrictionsWithAndroidApplications(currentKey.restrictions, applications);

  const currentApplications = currentKey?.restrictions?.androidKeyRestrictions?.allowedApplications;
  let alreadyCorrect = false;
  try {
    assertExactApplications(currentApplications, applications);
    alreadyCorrect = true;
  } catch (_error) {
    alreadyCorrect = false;
  }

  if (!alreadyCorrect) {
    console.log('[PROD_API_KEY] Android restrictions update started');
    const operation = await authorizedRequest(
      `${API_KEYS_BASE_URL}/${lookup.name}?updateMask=restrictions`,
      accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: lookup.name,
          etag: currentKey.etag,
          restrictions,
        }),
      }
    );
    await waitForOperation(operation, accessToken);
    console.log('[PROD_API_KEY] Android restrictions update completed');
  } else {
    console.log('[PROD_API_KEY] Android restrictions already current');
  }

  const verifiedKey = await authorizedRequest(`${API_KEYS_BASE_URL}/${lookup.name}`, accessToken);
  assertExactApplications(
    verifiedKey?.restrictions?.androidKeyRestrictions?.allowedApplications,
    applications
  );

  const firebaseShaResult = await ensureFirebaseAndroidShaCertificates({
    projectId: EXPECTED_PROJECT_ID,
    appId: build.firebaseConfig.appId,
    fingerprints,
    accessToken,
  });

  const preservedTargets = verifiedKey?.restrictions?.apiTargets?.length || 0;
  console.log(
    `[PROD_API_KEY] ✅ package + ${applications.length} Play signing certificates allowed; `
    + `apiTargets=${preservedTargets}; `
    + `firebaseSha1=${firebaseShaResult.registeredRequiredCount}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[PROD_API_KEY] BLOCKED code=${String(error?.message || error).slice(0, 240)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  expectedAllowedApplications,
  applicationKey,
  assertNoConflictingClientRestriction,
  restrictionsWithAndroidApplications,
  assertExactApplications,
  normalizedFirebaseSha1Set,
};
