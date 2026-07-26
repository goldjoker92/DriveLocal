import Constants from 'expo-constants';
import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

// Local-only safety fallback. EAS binaries must receive a validated config from
// app.config.js and are never allowed to use this checked-in DEV configuration.
const LOCAL_DEV_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyCjOL8bIjXIvWqdnda5vpdBuCHIaM-liBg',
  authDomain: 'drivelocal-dev.firebaseapp.com',
  projectId: 'drivelocal-dev',
  storageBucket: 'drivelocal-dev.firebasestorage.app',
  messagingSenderId: '539625523844',
  appId: '1:539625523844:web:00fcd2e9af3432f00090d1',
});

const REQUIRED_CONFIG_FIELDS = Object.freeze([
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]);

function readExtra() {
  return Constants.expoConfig?.extra
    || Constants.manifest?.extra
    || Constants.manifest2?.extra?.expoClient?.extra
    || {};
}

function assertFirebaseConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('[FIREBASE_CONFIG] Missing Firebase runtime configuration.');
  }

  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (!String(config[field] || '').trim()) {
      throw new Error(`[FIREBASE_CONFIG] Missing required field: ${field}.`);
    }
  }

  return config;
}

function resolveFirebaseRuntimeConfig(extra) {
  const appEnvironment = extra.appEnvironment === 'development'
    ? 'development'
    : 'production';
  const easBuildActive = extra.easBuildActive === true;
  const expectedProjectId = appEnvironment === 'development'
    ? 'drivelocal-dev'
    : 'drivelocal-prod';
  const injectedConfig = extra.firebaseConfig && typeof extra.firebaseConfig === 'object'
    ? extra.firebaseConfig
    : null;

  if (easBuildActive && extra.firebaseBuildValidated !== true) {
    throw new Error('[FIREBASE_CONFIG] EAS build was not validated by app.config.js.');
  }
  if (easBuildActive && !injectedConfig) {
    throw new Error('[FIREBASE_CONFIG] EAS build has no injected Firebase configuration.');
  }

  const firebaseConfig = assertFirebaseConfig(
    injectedConfig || LOCAL_DEV_FIREBASE_CONFIG
  );
  const declaredProjectId = String(extra.firebaseProjectId || '').trim();

  if (declaredProjectId && declaredProjectId !== firebaseConfig.projectId) {
    throw new Error(
      `[FIREBASE_CONFIG] Manifest project ${declaredProjectId} does not match `
      + `Firebase config project ${firebaseConfig.projectId}.`
    );
  }

  // This is the final runtime barrier after the build-time guard. A store binary
  // can never start while pointing at the DEV project, even if its manifest was
  // manually altered after app.config.js ran.
  if (easBuildActive && firebaseConfig.projectId !== expectedProjectId) {
    throw new Error(
      `[FIREBASE_CONFIG] ${appEnvironment} EAS build selected `
      + `${firebaseConfig.projectId}; expected ${expectedProjectId}.`
    );
  }

  return Object.freeze({
    appEnvironment,
    easBuildActive,
    expectedProjectId,
    projectId: firebaseConfig.projectId,
    source: injectedConfig
      ? String(extra.firebaseConfigSource || 'manifest')
      : 'local-dev-fallback',
    firebaseConfig,
  });
}

const firebaseRuntime = resolveFirebaseRuntimeConfig(readExtra());

// Safe startup trace. Firebase project IDs are public metadata; credentials,
// tokens, API keys and complete manifest contents are deliberately excluded.
console.info('[FIREBASE_CONFIG] runtime.initialized', {
  environment: firebaseRuntime.appEnvironment,
  projectId: firebaseRuntime.projectId,
  source: firebaseRuntime.source,
  easBuild: firebaseRuntime.easBuildActive,
});

const app = getApps().length === 0
  ? initializeApp(firebaseRuntime.firebaseConfig)
  : getApp();

const appStorage = ReactNativeAsyncStorage;

let auth;

try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(appStorage),
  });
} catch (error) {
  // Hot reload can attempt to initialize Auth twice. Reuse the existing instance
  // without logging config values or user data.
  auth = getAuth(app);
}

const db = getFirestore(app);
const storage = getStorage(app);
// Cloud Functions live in southamerica-east1 (see functions callables).
const functions = getFunctions(app, 'southamerica-east1');

export {
  app,
  auth,
  db,
  storage,
  functions,
  firebaseRuntime,
  resolveFirebaseRuntimeConfig,
};
