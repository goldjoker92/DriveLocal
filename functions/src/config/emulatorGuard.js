// @ts-check
// Test/integration safety: any code path that touches Firestore in tests must
// run ONLY against the local emulator. This guard fails closed when the emulator
// host is not configured, so tests can never silently hit cloud Firestore.
//
// Tests must NOT use service-account credentials.

const { AppError, ERROR_CODES } = require('../errors/appError');

// Throws unless FIRESTORE_EMULATOR_HOST is present. Cloud access is forbidden here.
function assertEmulator(env = process.env) {
  if (!env.FIRESTORE_EMULATOR_HOST) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage:
        'EMULATOR_REQUIRED: FIRESTORE_EMULATOR_HOST is not set; refusing to touch cloud Firestore.',
    });
  }
  return true;
}

function isEmulatorConfigured(env = process.env) {
  return Boolean(env.FIRESTORE_EMULATOR_HOST);
}

module.exports = { assertEmulator, isEmulatorConfigured };
