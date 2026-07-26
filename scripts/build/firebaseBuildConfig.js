'use strict';

// Build-time Firebase configuration for Expo/EAS.
//
// The Android native Firebase app and the Firebase JS SDK must always point to
// the same project. We therefore derive the public JS configuration directly
// from the selected google-services.json instead of maintaining two independent
// copies that can silently drift apart.

const fs = require('fs');
const path = require('path');

const EXPECTED_PROJECT_IDS = Object.freeze({
  development: 'drivelocal-dev',
  production: 'drivelocal-prod',
});

function normalizeAppEnvironment(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return ['dev', 'development'].includes(value) ? 'development' : 'production';
}

function isEasBuild(env = {}) {
  return ['1', 'true'].includes(String(env.EAS_BUILD || '').trim().toLowerCase());
}

function nonEmpty(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`[firebase-build] Missing ${fieldName} in google-services.json.`);
  }
  return normalized;
}

function resolveFilePath(filePath, cwd) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function readGoogleServicesJson(filePath, cwd = process.cwd()) {
  const resolvedPath = resolveFilePath(filePath, cwd);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`[firebase-build] google-services.json not found at ${resolvedPath}.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `[firebase-build] Invalid google-services.json at ${resolvedPath}: ${error.message}`
    );
  }

  return { parsed, resolvedPath };
}

function firebaseConfigFromGoogleServices(googleServices, packageName) {
  const projectInfo = googleServices?.project_info || {};
  const projectId = nonEmpty(projectInfo.project_id, 'project_info.project_id');
  const projectNumber = nonEmpty(projectInfo.project_number, 'project_info.project_number');
  const storageBucket = nonEmpty(projectInfo.storage_bucket, 'project_info.storage_bucket');
  const clients = Array.isArray(googleServices?.client) ? googleServices.client : [];
  const client = clients.find(
    (candidate) => candidate?.client_info?.android_client_info?.package_name === packageName
  );

  if (!client) {
    throw new Error(
      `[firebase-build] No Android Firebase client for package ${packageName}.`
    );
  }

  const apiKey = nonEmpty(client?.api_key?.[0]?.current_key, 'client.api_key.current_key');
  const appId = nonEmpty(client?.client_info?.mobilesdk_app_id, 'client_info.mobilesdk_app_id');

  return Object.freeze({
    apiKey,
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket,
    messagingSenderId: projectNumber,
    appId,
  });
}

function assertEnvironmentProject({ appEnvironment, projectId, easBuildActive }) {
  const expectedProjectId = EXPECTED_PROJECT_IDS[appEnvironment];
  if (!expectedProjectId) {
    throw new Error(`[firebase-build] Unsupported app environment: ${appEnvironment}.`);
  }

  // Local Expo commands may intentionally use the repository DEV file while
  // retaining production UI behavior. Every EAS binary is strict: DEV must use
  // drivelocal-dev and PROD must use drivelocal-prod.
  if (easBuildActive && projectId !== expectedProjectId) {
    throw new Error(
      `[firebase-build] ${appEnvironment} EAS build selected Firebase project `
      + `${projectId}; expected ${expectedProjectId}.`
    );
  }

  return expectedProjectId;
}

function loadFirebaseBuildConfig({
  env = process.env,
  cwd = process.cwd(),
  packageName = 'com.drivelocal.app',
  fallbackPath = './google-services.json',
} = {}) {
  const appEnvironment = normalizeAppEnvironment(env.APP_ENV);
  const easBuildActive = isEasBuild(env);
  const explicitFile = String(env.GOOGLE_SERVICES_JSON || '').trim();

  if (appEnvironment === 'production' && easBuildActive && !explicitFile) {
    throw new Error(
      '[firebase-build] Production EAS build requires GOOGLE_SERVICES_JSON '
      + 'pointing to the drivelocal-prod Firebase file.'
    );
  }

  const googleServicesFile = explicitFile || fallbackPath;
  const { parsed, resolvedPath } = readGoogleServicesJson(googleServicesFile, cwd);
  const firebaseConfig = firebaseConfigFromGoogleServices(parsed, packageName);
  const expectedProjectId = assertEnvironmentProject({
    appEnvironment,
    projectId: firebaseConfig.projectId,
    easBuildActive,
  });

  return Object.freeze({
    appEnvironment,
    easBuildActive,
    expectedProjectId,
    firebaseProjectId: firebaseConfig.projectId,
    firebaseConfig,
    googleServicesFile,
    googleServicesResolvedPath: resolvedPath,
    source: explicitFile ? 'environment-file' : 'repository-fallback',
  });
}

module.exports = {
  EXPECTED_PROJECT_IDS,
  normalizeAppEnvironment,
  isEasBuild,
  readGoogleServicesJson,
  firebaseConfigFromGoogleServices,
  assertEnvironmentProject,
  loadFirebaseBuildConfig,
};
