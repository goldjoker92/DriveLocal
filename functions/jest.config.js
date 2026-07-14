// Jest config for the DriveLocal Cloud Functions (Node backend).
// Deliberately isolated from the app's jest-expo (React Native) preset: backend
// code runs in a plain Node environment. Deterministic, one-shot runs.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  // Integration tests self-guard on FIRESTORE_EMULATOR_HOST (see __tests__).
};
