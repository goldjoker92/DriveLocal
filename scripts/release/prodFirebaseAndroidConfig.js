'use strict';

// Release-only loader for the protected Firebase Android configuration.
// Backend administration and Android Auth smoke tests must validate the
// committed PROD target, but they are not EAS builds and therefore must not
// depend on the six EXPO_PUBLIC_FIREBASE_* Web App variables.

const {
  firebaseConfigFromGoogleServices,
  readGoogleServicesJson,
} = require('../build/firebaseBuildConfig');

const EXPECTED_PROJECT_ID = 'drivelocal-prod';
const ANDROID_PACKAGE = 'com.drivelocal.app';

function loadProdFirebaseAndroidConfig({
  env = process.env,
  cwd = process.cwd(),
  packageName = ANDROID_PACKAGE,
  readGoogleServices = readGoogleServicesJson,
  configFromGoogleServices = firebaseConfigFromGoogleServices,
} = {}) {
  const googleServicesPath = String(env.GOOGLE_SERVICES_JSON || '').trim();
  if (!googleServicesPath) {
    throw new Error('missing GOOGLE_SERVICES_JSON');
  }

  const { parsed, resolvedPath } = readGoogleServices(googleServicesPath, cwd);
  const config = configFromGoogleServices(parsed, packageName);

  if (config.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`refusing project ${config.projectId}; expected ${EXPECTED_PROJECT_ID}`);
  }

  return Object.freeze({
    ...config,
    googleServicesResolvedPath: resolvedPath,
  });
}

module.exports = {
  ANDROID_PACKAGE,
  EXPECTED_PROJECT_ID,
  loadProdFirebaseAndroidConfig,
};
