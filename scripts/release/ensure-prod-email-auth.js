'use strict';

// Idempotently enables the exact Firebase Auth capability required by the
// DriveLocal closed-test app. This is deliberately PROD-only and requires an
// explicit confirmation plus a drivelocal-prod service account.

const { spawnSync } = require('child_process');

const { loadFirebaseBuildConfig } = require('../build/firebaseBuildConfig');
const { getServiceAccountAccessToken } = require('./googleServiceAccountAuth');

const EXPECTED_PROJECT_ID = 'drivelocal-prod';
const REQUIRED_CONFIRMATION = 'DRIVELOCAL_PRODUCTION';

async function readJsonResponse(response) {
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch (_error) { body = { raw: text.slice(0, 200) }; }
  }
  if (!response.ok) {
    const reason = body?.error?.message || body?.error?.status || `HTTP_${response.status}`;
    throw new Error(String(reason).slice(0, 180));
  }
  return body;
}

function authConfigUrl(projectId, updateMask = '') {
  const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config`;
  return updateMask ? `${base}?updateMask=${encodeURIComponent(updateMask)}` : base;
}

async function getConfig(projectId, accessToken) {
  return readJsonResponse(await fetch(authConfigUrl(projectId), {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'x-goog-user-project': projectId,
    },
  }));
}

function isReady(config) {
  return config?.signIn?.email?.enabled === true
    && config?.signIn?.email?.passwordRequired === true
    && config?.client?.permissions?.disabledUserSignup !== true;
}

function deployVersionedAuthConfig(projectId) {
  const firebaseCommand = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
  console.log('[PROD_AUTH_CONFIG] deploying versioned Firebase Auth provider configuration');

  const result = spawnSync(firebaseCommand, [
    'deploy',
    '--only',
    'auth',
    '--project',
    projectId,
    '--non-interactive',
  ], {
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`Firebase CLI could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Firebase Auth configuration deploy failed with exit code ${result.status}`);
  }
}

async function main() {
  if (process.env.CONFIRM_PRODUCTION_AUTH_CONFIG !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `production Auth mutation requires CONFIRM_PRODUCTION_AUTH_CONFIG=${REQUIRED_CONFIRMATION}`
    );
  }

  const build = loadFirebaseBuildConfig({
    env: { ...process.env, APP_ENV: 'prod', EAS_BUILD: '1' },
    packageName: 'com.drivelocal.app',
  });
  if (build.firebaseProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`refusing project ${build.firebaseProjectId}; expected ${EXPECTED_PROJECT_ID}`);
  }

  // The Firebase CLI creates the Authentication configuration when it does not
  // exist yet and applies the provider settings declared in firebase.json.
  deployVersionedAuthConfig(EXPECTED_PROJECT_ID);

  const accessToken = await getServiceAccountAccessToken({ expectedProjectId: EXPECTED_PROJECT_ID });
  const before = await getConfig(EXPECTED_PROJECT_ID, accessToken);
  if (isReady(before)) {
    console.log('[PROD_AUTH_CONFIG] project=drivelocal-prod email_password=enabled signup=enabled OK');
    return;
  }

  console.log('[PROD_AUTH_CONFIG] repairing password and end-user signup settings');
  const updateMask = [
    'signIn.email.enabled',
    'signIn.email.passwordRequired',
    'client.permissions.disabledUserSignup',
  ].join(',');

  await readJsonResponse(await fetch(authConfigUrl(EXPECTED_PROJECT_ID, updateMask), {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-goog-user-project': EXPECTED_PROJECT_ID,
    },
    body: JSON.stringify({
      name: `projects/${EXPECTED_PROJECT_ID}/config`,
      signIn: {
        email: {
          enabled: true,
          passwordRequired: true,
        },
      },
      client: {
        permissions: {
          disabledUserSignup: false,
        },
      },
    }),
  }));

  const after = await getConfig(EXPECTED_PROJECT_ID, accessToken);
  if (!isReady(after)) {
    throw new Error('email/password Auth configuration is still not ready after deployment and PATCH');
  }

  console.log('[PROD_AUTH_CONFIG] project=drivelocal-prod email_password=enabled signup=enabled REPAIRED');
}

main().catch((error) => {
  console.error(`[PROD_AUTH_CONFIG] BLOCKED code=${String(error?.message || error).slice(0, 180)}`);
  process.exitCode = 1;
});
