'use strict';

// Idempotently initializes and enables the exact Firebase Auth capability
// required by the DriveLocal closed-test app. This is deliberately PROD-only
// and requires an explicit confirmation plus a drivelocal-prod service account.

const { loadFirebaseBuildConfig } = require('../build/firebaseBuildConfig');
const { getServiceAccountAccessToken } = require('./googleServiceAccountAuth');

const EXPECTED_PROJECT_ID = 'drivelocal-prod';
const REQUIRED_CONFIRMATION = 'DRIVELOCAL_PRODUCTION';
const CONFIG_VISIBILITY_ATTEMPTS = 12;
const CONFIG_VISIBILITY_DELAY_MS = 1000;

class GoogleApiError extends Error {
  constructor({ status, code, message }) {
    super(String(message || code || `HTTP_${status}`).slice(0, 240));
    this.name = 'GoogleApiError';
    this.status = status;
    this.code = String(code || '').toUpperCase();
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_error) {
      body = { raw: text.slice(0, 240) };
    }
  }

  if (!response.ok) {
    throw new GoogleApiError({
      status: response.status,
      code: body?.error?.status || body?.error?.message,
      message: body?.error?.message || body?.error?.status || body?.raw || `HTTP_${response.status}`,
    });
  }

  return body;
}

function authConfigUrl(projectId, updateMask = '') {
  const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config`;
  return updateMask ? `${base}?updateMask=${encodeURIComponent(updateMask)}` : base;
}

function authInitializeUrl(projectId) {
  return `https://identitytoolkit.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/identityPlatform:initializeAuth`;
}

function authorizedHeaders(projectId, accessToken, includeJson = false) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-goog-user-project': projectId,
  };
  if (includeJson) headers['content-type'] = 'application/json';
  return headers;
}

function isMissingConfigError(error) {
  const message = String(error?.message || '').toUpperCase();
  return error?.status === 404
    || error?.code === 'CONFIGURATION_NOT_FOUND'
    || message.includes('CONFIGURATION_NOT_FOUND');
}

function isAlreadyInitializedError(error) {
  const message = String(error?.message || '').toUpperCase();
  return error?.status === 409
    || error?.code === 'ALREADY_EXISTS'
    || message.includes('ALREADY_EXISTS');
}

async function getConfig(projectId, accessToken, fetchImpl) {
  return parseJsonResponse(await fetchImpl(authConfigUrl(projectId), {
    headers: authorizedHeaders(projectId, accessToken),
  }));
}

async function getConfigOrNull(projectId, accessToken, fetchImpl) {
  try {
    return await getConfig(projectId, accessToken, fetchImpl);
  } catch (error) {
    if (isMissingConfigError(error)) return null;
    throw error;
  }
}

async function initializeAuth(projectId, accessToken, fetchImpl) {
  try {
    await parseJsonResponse(await fetchImpl(authInitializeUrl(projectId), {
      method: 'POST',
      headers: authorizedHeaders(projectId, accessToken),
    }));
  } catch (error) {
    // A concurrent/manual initialization is harmless; every other error is a
    // real release blocker and must remain visible in the workflow logs.
    if (!isAlreadyInitializedError(error)) throw error;
  }
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForConfig(projectId, accessToken, fetchImpl, sleepImpl = sleep) {
  for (let attempt = 1; attempt <= CONFIG_VISIBILITY_ATTEMPTS; attempt += 1) {
    const config = await getConfigOrNull(projectId, accessToken, fetchImpl);
    if (config) return config;
    if (attempt < CONFIG_VISIBILITY_ATTEMPTS) {
      await sleepImpl(CONFIG_VISIBILITY_DELAY_MS);
    }
  }

  throw new Error('Firebase Auth configuration was initialized but did not become readable');
}

function isReady(config) {
  return config?.signIn?.email?.enabled === true
    && config?.signIn?.email?.passwordRequired === true
    && config?.client?.permissions?.disabledUserSignup !== true;
}

async function patchRequiredSettings(projectId, accessToken, fetchImpl) {
  const updateMask = [
    'signIn.email.enabled',
    'signIn.email.passwordRequired',
    'client.permissions.disabledUserSignup',
  ].join(',');

  await parseJsonResponse(await fetchImpl(authConfigUrl(projectId, updateMask), {
    method: 'PATCH',
    headers: authorizedHeaders(projectId, accessToken, true),
    body: JSON.stringify({
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
}

async function ensureProdEmailAuth({
  env = process.env,
  fetchImpl = globalThis.fetch,
  loadBuildConfig = loadFirebaseBuildConfig,
  getAccessToken = getServiceAccountAccessToken,
  sleepImpl = sleep,
  logger = console,
} = {}) {
  if (env.CONFIRM_PRODUCTION_AUTH_CONFIG !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `production Auth mutation requires CONFIRM_PRODUCTION_AUTH_CONFIG=${REQUIRED_CONFIRMATION}`
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable');
  }

  const build = loadBuildConfig({
    env: { ...env, APP_ENV: 'prod', EAS_BUILD: '1' },
    packageName: 'com.drivelocal.app',
  });
  if (build.firebaseProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`refusing project ${build.firebaseProjectId}; expected ${EXPECTED_PROJECT_ID}`);
  }

  const accessToken = await getAccessToken({ expectedProjectId: EXPECTED_PROJECT_ID });
  let config = await getConfigOrNull(EXPECTED_PROJECT_ID, accessToken, fetchImpl);

  if (!config) {
    logger.log('[PROD_AUTH_CONFIG] configuration missing; initializing Firebase Authentication');
    await initializeAuth(EXPECTED_PROJECT_ID, accessToken, fetchImpl);
    config = await waitForConfig(
      EXPECTED_PROJECT_ID,
      accessToken,
      fetchImpl,
      sleepImpl
    );
  }

  if (isReady(config)) {
    logger.log('[PROD_AUTH_CONFIG] project=drivelocal-prod email_password=enabled signup=enabled OK');
    return;
  }

  logger.log('[PROD_AUTH_CONFIG] repairing email/password and end-user signup settings');
  await patchRequiredSettings(EXPECTED_PROJECT_ID, accessToken, fetchImpl);

  const after = await getConfig(EXPECTED_PROJECT_ID, accessToken, fetchImpl);
  if (!isReady(after)) {
    throw new Error('email/password Auth configuration is still not ready after PATCH');
  }

  logger.log('[PROD_AUTH_CONFIG] project=drivelocal-prod email_password=enabled signup=enabled REPAIRED');
}

async function main() {
  await ensureProdEmailAuth();
}

if (require.main === module) {
  main().catch((error) => {
    const code = error?.code || error?.message || error;
    console.error(`[PROD_AUTH_CONFIG] BLOCKED code=${String(code).slice(0, 240)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIG_VISIBILITY_ATTEMPTS,
  EXPECTED_PROJECT_ID,
  GoogleApiError,
  REQUIRED_CONFIRMATION,
  authConfigUrl,
  authInitializeUrl,
  ensureProdEmailAuth,
  getConfigOrNull,
  initializeAuth,
  isAlreadyInitializedError,
  isMissingConfigError,
  isReady,
  parseJsonResponse,
  patchRequiredSettings,
  waitForConfig,
};
