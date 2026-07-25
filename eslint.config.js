// Expo SDK 56 uses ESLint flat config. Keep runtime environments explicit so the
// mobile app, Node/Firebase code and Jest tests can be linted from one command.

const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const nodeGlobals = {
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  exports: 'writable',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
};

const jestGlobals = {
  afterAll: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  it: 'readonly',
  jest: 'readonly',
  test: 'readonly',
};

module.exports = defineConfig([
  globalIgnores([
    '.expo/**',
    'android/**',
    'coverage/**',
    'dist/**',
    'functions/coverage/**',
    'ios/**',
    'node_modules/**',
  ]),
  expoConfig,
  {
    files: [
      'app.config.js',
      'babel.config.js',
      'metro.config.js',
      'scripts/**/*.js',
      'functions/**/*.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
  },
  {
    files: [
      '**/*.test.js',
      '**/*.test.jsx',
      '**/__tests__/**/*.js',
      '**/__tests__/**/*.jsx',
    ],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        ...jestGlobals,
      },
    },
  },
]);
