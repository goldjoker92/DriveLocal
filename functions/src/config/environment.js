// @ts-check
// Explicit DriveLocal environment resolver.
//
// The environment is resolved EXPLICITLY — never from NODE_ENV, and an unknown
// project is NEVER defaulted to production. Precedence:
//   1. emulator detection (FIRESTORE_EMULATOR_HOST or FUNCTIONS_EMULATOR);
//   2. Firebase project id mapped to a known environment;
//   3. optional APP_ENV must not contradict the project mapping.
// Unknown project id or contradictory config throws CONFIGURATION_MISSING.

const { AppError, ERROR_CODES } = require('../errors/appError');

const ENVIRONMENTS = Object.freeze({
  EMULATOR: 'emulator',
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
});

// Known DriveLocal Firebase project ids -> deployment environment.
const PROJECT_ENV = Object.freeze({
  'drivelocal-dev': ENVIRONMENTS.DEVELOPMENT,
  'drivelocal-prod': ENVIRONMENTS.PRODUCTION,
});

/**
 * @param {{env?:object, projectId?:string, appEnv?:string,
 *          firestoreEmulatorHost?:string, functionsEmulator?:string}} [input]
 * @returns {string} one of ENVIRONMENTS
 */
function resolveEnvironment(input = {}) {
  const env = input.env || process.env;
  const emulatorHost =
    input.firestoreEmulatorHost != null ? input.firestoreEmulatorHost : env.FIRESTORE_EMULATOR_HOST;
  const functionsEmulator =
    input.functionsEmulator != null ? input.functionsEmulator : env.FUNCTIONS_EMULATOR;
  const projectId =
    input.projectId != null
      ? input.projectId
      : env.GCLOUD_PROJECT || env.GCP_PROJECT || env.FIREBASE_PROJECT_ID || undefined;
  const appEnv = input.appEnv != null ? input.appEnv : env.APP_ENV;

  // 1. Emulator wins (local dev / automated tests).
  if (emulatorHost || functionsEmulator === 'true') {
    return ENVIRONMENTS.EMULATOR;
  }

  // 2. A real environment requires a known project id.
  if (!projectId) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: 'No project id and no emulator host; cannot resolve environment.',
    });
  }
  const resolved = PROJECT_ENV[projectId];
  if (!resolved) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: `Unknown project id "${projectId}"; refusing to default to production.`,
    });
  }

  // 3. If APP_ENV is provided it must agree with the project mapping.
  if (appEnv && appEnv !== resolved) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: `APP_ENV "${appEnv}" contradicts project "${projectId}" (${resolved}).`,
    });
  }
  return resolved;
}

function isProduction(environment) {
  return environment === ENVIRONMENTS.PRODUCTION;
}

module.exports = { ENVIRONMENTS, PROJECT_ENV, resolveEnvironment, isProduction };
