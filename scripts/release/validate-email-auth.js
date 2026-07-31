'use strict';

// Non-mutating Firebase Authentication readiness check.
//
// The probe submits deliberately invalid, unique credentials to the selected
// Firebase project's signInWithPassword endpoint. A normal invalid-credential
// response proves that the API key, Android Firebase project and Email/Password
// provider are reachable. It never creates a user and never logs the API key,
// probe email, password or response payload.

const fs = require('fs');
const path = require('path');

const {
  readGoogleServicesJson,
  firebaseConfigFromGoogleServices,
} = require('../build/firebaseBuildConfig');

const ROOT = path.resolve(__dirname, '../..');
const HEALTHY_AUTH_FAILURES = new Set([
  'EMAIL_NOT_FOUND',
  'INVALID_PASSWORD',
  'INVALID_LOGIN_CREDENTIALS',
]);

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function safeErrorCode(payload) {
  const raw = String(payload?.error?.message || '').trim();
  if (!raw) return 'UNKNOWN_RESPONSE';
  return raw.split(/[:\s]/)[0].replace(/[^A-Z0-9_-]/gi, '') || 'UNKNOWN_RESPONSE';
}

function resolveFirebaseClientConfig({
  env = process.env,
  cwd = ROOT,
  explicitFile = '',
  requireExplicitFile = false,
} = {}) {
  const appJson = JSON.parse(fs.readFileSync(path.join(cwd, 'app.json'), 'utf8'));
  const packageName = appJson?.expo?.android?.package || 'com.drivelocal.app';
  const fallbackPath = appJson?.expo?.android?.googleServicesFile || './google-services.json';
  const environmentFile = String(env.GOOGLE_SERVICES_JSON || '').trim();
  const requestedFile = String(explicitFile || environmentFile || '').trim();

  if (requireExplicitFile && !requestedFile) {
    throw new Error(
      'GOOGLE_SERVICES_JSON or --google-services is required for the production Auth probe.'
    );
  }

  const filePath = requestedFile || fallbackPath;
  const { parsed } = readGoogleServicesJson(filePath, cwd);
  return firebaseConfigFromGoogleServices(parsed, packageName);
}

async function probeEmailPasswordAuth({ firebaseConfig, timeoutMs = 12_000 } = {}) {
  const projectId = String(firebaseConfig?.projectId || '').trim();
  const apiKey = String(firebaseConfig?.apiKey || '').trim();
  if (!projectId || !apiKey) {
    throw new Error('Firebase client configuration is incomplete.');
  }

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const endpoint =
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `drivelocal-auth-probe-${nonce}@example.invalid`,
        password: `invalid-${nonce}`,
        returnSecureToken: true,
      }),
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (response.ok) {
      throw new Error('Auth probe unexpectedly authenticated invalid credentials.');
    }

    const providerResult = safeErrorCode(payload);
    if (!HEALTHY_AUTH_FAILURES.has(providerResult)) {
      const error = new Error(`Email/Password Auth probe failed with ${providerResult}.`);
      error.code = providerResult;
      throw error;
    }

    return Object.freeze({
      projectId,
      provider: 'password',
      reachable: true,
      result: providerResult,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Email/Password Auth probe timed out.');
      timeoutError.code = 'AUTH_PROBE_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const expectedProjectId = arg('expect-project');
  const explicitFile = arg('google-services');
  const requireExplicitFile = flag('require-explicit-file');

  if (!expectedProjectId) {
    throw new Error('Missing --expect-project <firebaseProjectId>.');
  }

  const firebaseConfig = resolveFirebaseClientConfig({
    explicitFile,
    requireExplicitFile,
  });

  if (firebaseConfig.projectId !== expectedProjectId) {
    throw new Error(
      `Selected Firebase project is ${firebaseConfig.projectId}; expected ${expectedProjectId}.`
    );
  }

  const result = await probeEmailPasswordAuth({ firebaseConfig });
  console.log(
    `[AUTH_PROBE] OK project=${result.projectId} provider=${result.provider} `
      + `reachable=${result.reachable} result=${result.result}`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[AUTH_PROBE] BLOCKED: ${error?.code || error?.message || 'unknown_error'}`);
    process.exitCode = 1;
  });
}

module.exports = {
  HEALTHY_AUTH_FAILURES,
  safeErrorCode,
  resolveFirebaseClientConfig,
  probeEmailPasswordAuth,
};
