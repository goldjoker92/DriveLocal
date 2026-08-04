'use strict';

// Build-time Firebase configuration for Expo/EAS.
//
// Android native Firebase keeps using google-services.json. The Firebase JS SDK
// (Auth, Firestore, Storage and Functions) must use the registered Firebase Web
// App configuration. The remote EAS worker validates both sides against the same
// project. The local EAS CLI config pass cannot read Secret file variables, so it
// may inspect the checked-in DEV Android file without treating it as the binary's
// final Firebase file.

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

const LOCAL_EAS_CONFIG_FALLBACK_ENV = 'EAS_CONFIG_ALLOW_LOCAL_GOOGLE_SERVICES_FALLBACK';

function normalizeAppEnvironment(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return ['dev', 'development'].includes(value) ? 'development' : 'production';
}

function envEnabled(value) {
  return ['1', 'true'].includes(String(value || '').trim().toLowerCase());
}

function isEasBuild(env = {}) {
  return envEnabled(env.EAS_BUILD);
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

function expectedProjectForEnvironment(appEnvironment) {
  const expectedProjectId = EXPECTED_PROJECT_IDS[appEnvironment];
  if (!expectedProjectId) {
    throw new Error(`[firebase-build] Unsupported app environment: ${appEnvironment}.`);
  }
  return expectedProjectId;
}

function assertEnvironmentProject({ appEnvironment, projectId, allowMismatch = false }) {
  const expectedProjectId = expectedProjectForEnvironment(appEnvironment);

  if (!allowMismatch && projectId !== expectedProjectId) {
    throw new Error(
      `[firebase-build] ${appEnvironment} build selected Firebase project `
      + `${projectId}; expected ${expectedProjectId}.`
    );
  }

  return expectedProjectId;
}

function assertFirebaseWebConfig({
  config,
  androidConfig,
  expectedProjectId,
  compareAndroidConfig = true,
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

  if (config.projectId !== expectedProjectId) {
    throw new Error(
      `[firebase-build] Firebase Web project ${config.projectId}; `
      + `expected ${expectedProjectId}.`
    );
  }

  if (compareAndroidConfig) {
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
  const expectedProjectId = expectedProjectForEnvironment(appEnvironment);
  const explicitFile = String(env.GOOGLE_SERVICES_JSON || '').trim();
  const localEasConfigFallbackRequested = envEnabled(
    env[LOCAL_EAS_CONFIG_FALLBACK_ENV]
  );
  const webConfigResult = readFirebaseWebConfig(env);

  // Fail closed on the remote worker. PROD can never be compiled there without
  // the EAS file variable that points to the drivelocal-prod Android app file.
  if (easBuildActive && appEnvironment === 'production' && !explicitFile) {
    throw new Error(
      '[firebase-build] Production EAS build requires GOOGLE_SERVICES_JSON '
      + 'pointing to the drivelocal-prod Firebase file.'
    );
  }

  if (easBuildActive && !webConfigResult.configured) {
    throw new Error(
      '[firebase-build] EAS build requires the six EXPO_PUBLIC_FIREBASE_* values '
      + 'from the registered Firebase Web App.'
    );
  }

  const googleServicesFile = explicitFile || fallbackPath;
  const { parsed, resolvedPath } = readGoogleServicesJson(googleServicesFile, cwd);
  const androidConfig = firebaseConfigFromGoogleServices(parsed, packageName);
  const androidFirebaseMatchesExpected = androidConfig.projectId === expectedProjectId;

  // EAS CLI resolves app.config.js locally before upload. Secret file variables
  // are unavailable at that stage. The production profile explicitly permits the
  // checked-in DEV file only for that local pass; the remote pass above remains
  // strict and re-checks the real PROD Android file against the PROD Web config.
  const localEasConfigFallbackActive = Boolean(
    !easBuildActive
      && !explicitFile
      && localEasConfigFallbackRequested
      && webConfigResult.configured
      && !androidFirebaseMatchesExpected
  );

  // Ordinary local Expo commands remain usable with the checked-in DEV file when
  // no Firebase Web environment is loaded. This path cannot create a store build.
  const runtimeLocalDevFallback = Boolean(
    !easBuildActive
      && !explicitFile
      && !webConfigResult.configured
      && androidConfig.projectId === 'drivelocal-dev'
      && !androidFirebaseMatchesExpected
  );

  assertEnvironmentProject({
    appEnvironment,
    projectId: androidConfig.projectId,
    allowMismatch: localEasConfigFallbackActive || runtimeLocalDevFallback,
  });

  let firebaseConfig = null;
  if (webConfigResult.configured) {
    firebaseConfig = assertFirebaseWebConfig({
      config: webConfigResult.config,
      androidConfig,
      expectedProjectId,
      compareAndroidConfig: androidFirebaseMatchesExpected,
    });
  } else if (androidConfig.projectId !== 'drivelocal-dev') {
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
    androidFirebaseMatchesExpected,
    firebaseConfig,
    firebaseWebConfigValidated: Boolean(firebaseConfig),
    googleServicesFile,
    googleServicesResolvedPath: resolvedPath,
    localEasConfigFallbackActive,
    source: localEasConfigFallbackActive
      ? 'environment-web-config-local-android-fallback'
      : firebaseConfig
        ? 'environment-web-config'
        : 'runtime-local-dev-fallback',
  });
}

module.exports = {
  EXPECTED_PROJECT_IDS,
  FIREBASE_WEB_ENV_FIELDS,
  LOCAL_EAS_CONFIG_FALLBACK_ENV,
  normalizeAppEnvironment,
  isEasBuild,
  readGoogleServicesJson,
  firebaseConfigFromGoogleServices,
  readFirebaseWebConfig,
  assertEnvironmentProject,
  assertFirebaseWebConfig,
  loadFirebaseBuildConfig,
};
