'use strict';

// Build-time Firebase configuration for Expo/EAS.
//
// Android native Firebase keeps using google-services.json. The Firebase JS SDK
// (Auth, Firestore, Storage and Functions) must use the registered Firebase Web
// App configuration. Both sides are validated against the same project so DEV
// and PROD cannot silently drift apart.

const fs = require('fs');
const path = require('path');

const EXPECTED_PROJECT_IDS = Object.freeze({
  development: 'drivelocal-dev',
  production: 'drivelocal-prod',
});

const FIREBASE_WEB_ENV_FIELDS = Object.freeze({
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
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
    throw new Error(`[firebase-build] Missing ${fieldName}.`);
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

// Android metadata only. This object is never passed to initializeApp().
function firebaseConfigFromGoogleServices(googleServices, packageName) {
  const projectInfo = googleServices?.project_info || {};
  const projectId = nonEmpty(
    projectInfo.project_id,
    'project_info.project_id in google-services.json'
  );
  const projectNumber = nonEmpty(
    projectInfo.project_number,
    'project_info.project_number in google-services.json'
  );
  const storageBucket = nonEmpty(
    projectInfo.storage_bucket,
    'project_info.storage_bucket in google-services.json'
  );
  const clients = Array.isArray(googleServices?.client) ? googleServices.client : [];
  const client = clients.find(
    (candidate) => candidate?.client_info?.android_client_info?.package_name === packageName
  );

  if (!client) {
    throw new Error(
      `[firebase-build] No Android Firebase client for package ${packageName}.`
    );
  }

  const apiKey = nonEmpty(
    client?.api_key?.[0]?.current_key,
    'client.api_key.current_key in google-services.json'
  );
  const appId = nonEmpty(
    client?.client_info?.mobilesdk_app_id,
    'client_info.mobilesdk_app_id in google-services.json'
  );

  return Object.freeze({
    apiKey,
    appId,
    packageName,
    projectId,
    projectNumber,
    storageBucket,
  });
}

function readFirebaseWebConfig(env = {}) {
  const values = {};
  const missing = [];

  for (const [field, envName] of Object.entries(FIREBASE_WEB_ENV_FIELDS)) {
    const value = String(env[envName] || '').trim();
    values[field] = value;
    if (!value) missing.push(envName);
  }

  const configuredCount = Object.values(values).filter(Boolean).length;
  if (configuredCount === 0) {
    return Object.freeze({
      configured: false,
      config: null,
      missing: Object.values(FIREBASE_WEB_ENV_FIELDS),
    });
  }

  if (missing.length > 0) {
    throw new Error(
      `[firebase-build] Firebase Web configuration is incomplete; missing: ${missing.join(', ')}.`
    );
  }

  return Object.freeze({
    configured: true,
    config: Object.freeze(values),
    missing: [],
  });
}

function assertEnvironmentProject({ appEnvironment, projectId, easBuildActive }) {
  const expectedProjectId = EXPECTED_PROJECT_IDS[appEnvironment];
  if (!expectedProjectId) {
    throw new Error(`[firebase-build] Unsupported app environment: ${appEnvironment}.`);
  }

  // Local Expo commands may intentionally use the repository DEV file while
  // retaining production UI behavior. Every EAS binary remains strict.
  if (easBuildActive && projectId !== expectedProjectId) {
    throw new Error(
      `[firebase-build] ${appEnvironment} EAS build selected Firebase project `
      + `${projectId}; expected ${expectedProjectId}.`
    );
  }

  return expectedProjectId;
}

function assertFirebaseWebConfig({
  config,
  androidConfig,
  expectedProjectId,
  easBuildActive,
}) {
  const expectedAuthDomain = `${config.projectId}.firebaseapp.com`;

  if (config.authDomain !== expectedAuthDomain) {
    throw new Error(
      `[firebase-build] Firebase Web authDomain ${config.authDomain} does not match `
      + `${expectedAuthDomain}.`
    );
  }

  if (!/^1:[0-9]+:web:[A-Za-z0-9_-]+$/.test(config.appId)) {
    throw new Error(
      '[firebase-build] EXPO_PUBLIC_FIREBASE_APP_ID must be a Firebase Web App ID '
      + '(format 1:<sender>:web:<id>).'
    );
  }

  const appIdSenderId = config.appId.split(':')[1];
  if (appIdSenderId !== config.messagingSenderId) {
    throw new Error(
      '[firebase-build] Firebase Web appId sender does not match messagingSenderId.'
    );
  }

  if (config.projectId !== androidConfig.projectId) {
    throw new Error(
      `[firebase-build] Firebase Web project ${config.projectId} does not match `
      + `Android project ${androidConfig.projectId}.`
    );
  }

  if (config.messagingSenderId !== androidConfig.projectNumber) {
    throw new Error(
      `[firebase-build] Firebase Web messagingSenderId ${config.messagingSenderId} `
      + `does not match Android project number ${androidConfig.projectNumber}.`
    );
  }

  if (config.storageBucket !== androidConfig.storageBucket) {
    throw new Error(
      `[firebase-build] Firebase Web storageBucket ${config.storageBucket} does not `
      + `match Android storage bucket ${androidConfig.storageBucket}.`
    );
  }

  if (easBuildActive && config.projectId !== expectedProjectId) {
    throw new Error(
      `[firebase-build] Firebase Web project ${config.projectId}; `
      + `expected ${expectedProjectId}.`
    );
  }

  return config;
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

  // Secret file variables exist only on the remote EAS worker. During EAS CLI's
  // local app-config resolution they can be unavailable, so use the local fallback.
  // The project/package/Web-config assertions below still fail closed if that
  // fallback is not the matching DEV or PROD Android application file.
  const googleServicesFile = explicitFile || fallbackPath;
  const { parsed, resolvedPath } = readGoogleServicesJson(googleServicesFile, cwd);
  const androidConfig = firebaseConfigFromGoogleServices(parsed, packageName);
  const expectedProjectId = assertEnvironmentProject({
    appEnvironment,
    projectId: androidConfig.projectId,
    easBuildActive,
  });

  const webConfigResult = readFirebaseWebConfig(env);
  if (easBuildActive && !webConfigResult.configured) {
    throw new Error(
      '[firebase-build] EAS build requires the six EXPO_PUBLIC_FIREBASE_* values '
      + 'from the registered Firebase Web App.'
    );
  }

  let firebaseConfig = null;
  if (webConfigResult.configured) {
    firebaseConfig = assertFirebaseWebConfig({
      config: webConfigResult.config,
      androidConfig,
      expectedProjectId,
      easBuildActive,
    });
  } else if (androidConfig.projectId !== 'drivelocal-dev') {
    // Without a Web config, the runtime fallback is intentionally DEV-only.
    throw new Error(
      '[firebase-build] A non-DEV Firebase Android project requires an explicit '
      + 'Firebase Web configuration.'
    );
  }

  return Object.freeze({
    appEnvironment,
    easBuildActive,
    expectedProjectId,
    firebaseProjectId: firebaseConfig?.projectId || androidConfig.projectId,
    androidFirebaseProjectId: androidConfig.projectId,
    androidFirebaseAppId: androidConfig.appId,
    androidFirebaseProjectNumber: androidConfig.projectNumber,
    firebaseConfig,
    firebaseWebConfigValidated: Boolean(firebaseConfig),
    googleServicesFile,
    googleServicesResolvedPath: resolvedPath,
    source: firebaseConfig
      ? 'environment-web-config'
      : 'runtime-local-dev-fallback',
  });
}

module.exports = {
  EXPECTED_PROJECT_IDS,
  FIREBASE_WEB_ENV_FIELDS,
  normalizeAppEnvironment,
  isEasBuild,
  readGoogleServicesJson,
  firebaseConfigFromGoogleServices,
  readFirebaseWebConfig,
  assertEnvironmentProject,
  assertFirebaseWebConfig,
  loadFirebaseBuildConfig,
};
