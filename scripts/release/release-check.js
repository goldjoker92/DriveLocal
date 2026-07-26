'use strict';

// DriveLocal production release gate.
//
// This script is deliberately non-mutating: it runs checks and tests only. It
// never deploys Firebase, builds an APK/AAB, submits to Play or changes secrets.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { loadFirebaseBuildConfig } = require('../build/firebaseBuildConfig');
const { loadPublicPolicyConfig } = require('../build/publicPolicyConfig');

const ROOT = path.resolve(__dirname, '../..');
const REQUIRED_CONFIRMATION = 'YES';
const REQUIRED_SECRET_NAMES = Object.freeze([
  'ROUTING_PROVIDER_API_KEY',
  'MERCADO_PAGO_ACCESS_TOKEN',
  'MERCADO_PAGO_WEBHOOK_SECRET',
]);

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function nonEmpty(value) {
  return String(value || '').trim().length > 0;
}

function collectSourceFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(absolutePath, output);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      output.push(absolutePath);
    }
  }
  return output;
}

function validateStaticConfiguration(env = process.env) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };

  let appJson;
  let packageJson;
  let easJson;
  let firebaseJson;

  try { appJson = readJson('app.json'); } catch (error) { problems.push(`app.json invalide: ${error.message}`); }
  try { packageJson = readJson('package.json'); } catch (error) { problems.push(`package.json invalide: ${error.message}`); }
  try { easJson = readJson('eas.json'); } catch (error) { problems.push(`eas.json invalide: ${error.message}`); }
  try { firebaseJson = readJson('firebase.json'); } catch (error) { problems.push(`firebase.json invalide: ${error.message}`); }

  const expo = appJson?.expo || {};
  const android = expo.android || {};
  const productionProfile = easJson?.build?.production || {};

  check(packageJson?.version === expo.version, 'package.json et app.json doivent avoir la même version.');
  check(android.package === 'com.drivelocal.app', 'Le package Android doit rester com.drivelocal.app.');
  check(Number.isInteger(android.versionCode) && android.versionCode >= 1,
    'android.versionCode doit être un entier positif.');
  check(productionProfile.distribution === 'store', 'Le profil EAS production doit utiliser distribution=store.');
  check(productionProfile.android?.buildType === 'app-bundle',
    'Le profil EAS production doit produire un app-bundle.');
  check(productionProfile.env?.APP_ENV === 'prod', 'Le profil EAS production doit utiliser APP_ENV=prod.');
  check(String(productionProfile.env?.ENABLE_DEV_RIDE_SIMULATOR) === '0',
    'Robot Driver doit être désactivé dans le profil production.');
  check(easJson?.submit?.production?.android?.track === 'production',
    'Le profil de soumission Android doit viser la piste production.');

  check(env.RELEASE_CONFIRM_PROD_SECRETS === REQUIRED_CONFIRMATION,
    'Confirmer les secrets PROD avec RELEASE_CONFIRM_PROD_SECRETS=YES.');
  check(env.RELEASE_CONFIRM_DEV_APK === REQUIRED_CONFIRMATION,
    'Confirmer l’APK DEV validé avec RELEASE_CONFIRM_DEV_APK=YES.');
  check(nonEmpty(env.GOOGLE_MAPS_ANDROID_API_KEY),
    'GOOGLE_MAPS_ANDROID_API_KEY est requis pour la production.');
  check(nonEmpty(env.GOOGLE_SERVICES_JSON),
    'GOOGLE_SERVICES_JSON doit pointer vers le fichier Firebase drivelocal-prod.');

  try {
    const publicPolicy = loadPublicPolicyConfig({
      env,
      appEnvironment: 'production',
      easBuildActive: true,
    });
    check(publicPolicy.configured === true, 'Les trois URLs légales publiques doivent être configurées.');
  } catch (error) {
    problems.push(error.message);
  }

  if (nonEmpty(env.GOOGLE_SERVICES_JSON) && android.package) {
    try {
      const firebaseBuild = loadFirebaseBuildConfig({
        env: { ...env, APP_ENV: 'prod', EAS_BUILD: '1' },
        cwd: ROOT,
        packageName: android.package,
        fallbackPath: android.googleServicesFile || './google-services.json',
      });
      check(firebaseBuild.firebaseProjectId === 'drivelocal-prod',
        'Le fichier GOOGLE_SERVICES_JSON doit cibler drivelocal-prod.');
    } catch (error) {
      problems.push(error.message);
    }
  }

  const requiredFiles = [
    'backend/firebase/rules/firestore.rules',
    'backend/firebase/rules/storage.rules',
    'backend/firebase/indexes/firestore.indexes.json',
    'assets/images/notification-icon.png',
  ];
  requiredFiles.forEach((relativePath) => check(exists(relativePath), `Fichier requis absent: ${relativePath}`));

  if (firebaseJson) {
    check(firebaseJson.firestore?.rules === 'backend/firebase/rules/firestore.rules',
      'firebase.json doit pointer vers les règles Firestore versionnées.');
    check(firebaseJson.firestore?.indexes === 'backend/firebase/indexes/firestore.indexes.json',
      'firebase.json doit pointer vers les indexes Firestore versionnés.');
    check(firebaseJson.storage?.rules === 'backend/firebase/rules/storage.rules',
      'firebase.json doit pointer vers les règles Storage versionnées.');
  }

  if (exists('backend/firebase/indexes/firestore.indexes.json')) {
    try {
      const indexes = readJson('backend/firebase/indexes/firestore.indexes.json');
      check(Array.isArray(indexes.indexes), 'firestore.indexes.json doit contenir un tableau indexes.');
    } catch (error) {
      problems.push(`firestore.indexes.json invalide: ${error.message}`);
    }
  }

  if (exists('backend/firebase/rules/firestore.rules')) {
    check(readText('backend/firebase/rules/firestore.rules').includes("rules_version = '2'"),
      'Les règles Firestore doivent utiliser rules_version = 2.');
  }
  if (exists('backend/firebase/rules/storage.rules')) {
    check(readText('backend/firebase/rules/storage.rules').includes("rules_version = '2'"),
      'Les règles Storage doivent utiliser rules_version = 2.');
  }

  if (exists('app.config.js')) {
    const appConfig = readText('app.config.js');
    check(appConfig.includes("'expo-notifications'"), 'Le plugin expo-notifications doit rester configuré.');
    check(appConfig.includes("defaultChannel: 'drivelocal-ride-status'"),
      'Le canal Android de notifications doit rester configuré.');
    check(appConfig.includes("'react-native-maps'"), 'Le plugin react-native-maps doit rester configuré.');
    check(appConfig.includes("appEnvironment === 'development'")
      && appConfig.includes("ENABLE_DEV_RIDE_SIMULATOR === '1'"),
    'Le simulateur doit rester limité aux builds development.');
  }

  if (exists('src/config/runtimeEnvironment.js')) {
    const runtimeEnvironment = readText('src/config/runtimeEnvironment.js');
    check(runtimeEnvironment.includes("APP_ENVIRONMENT === 'development'")
      && runtimeEnvironment.includes('extra.devRideSimulatorEnabled === true'),
    'Le verrou runtime du simulateur DEV est absent ou modifié.');
  }

  if (exists('functions/scripts/validate-config.js')) {
    const validationSource = readText('functions/scripts/validate-config.js');
    REQUIRED_SECRET_NAMES.forEach((secretName) => {
      check(validationSource.includes(secretName), `Secret backend attendu non déclaré: ${secretName}`);
    });
  }

  if (exists('src/app/(admin)/topups-pending.jsx')) {
    const topups = readText('src/app/(admin)/topups-pending.jsx');
    check(!/MOCK_TOPUPS|Ana Pereira|Pedro Alves/.test(topups),
      'L’écran Recargas contient encore des données fictives.');
  }

  const mockFiles = collectSourceFiles(path.join(ROOT, 'src'))
    .filter((filePath) => /\bMOCK_[A-Z0-9_]+\b/.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(ROOT, filePath));
  check(mockFiles.length === 0,
    `Données MOCK_ détectées dans le code application: ${mockFiles.join(', ')}`);

  return problems;
}

function runCommand(label, args) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`\n[RELEASE] ${label}`);
  const result = spawnSync(npmCommand, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} a échoué avec le code ${result.status}.`);
  }
  console.log(`[RELEASE] OK — ${label}`);
}

function main() {
  console.log('[RELEASE] DriveLocal — contrôle non mutatif de sortie production');
  console.log('[RELEASE] Aucun deploy, build ou submit ne sera lancé.');

  const problems = validateStaticConfiguration(process.env);
  if (problems.length > 0) {
    console.error('\n[RELEASE] BLOQUÉ:');
    problems.forEach((problem) => console.error(` - ${problem}`));
    process.exitCode = 1;
    return;
  }

  console.log('[RELEASE] OK — configuration statique production');

  try {
    runCommand('Tests application', ['test']);
    runCommand('Tests Firebase Functions', ['--prefix', 'functions', 'test']);
    runCommand('Configuration Firebase PROD', ['run', 'validate:env:prod']);
  } catch (error) {
    console.error(`\n[RELEASE] BLOQUÉ — ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n[RELEASE] ✅ GATE VERT');
  console.log('[RELEASE] Étape suivante autorisée: Production AAB, uniquement après décision explicite.');
}

if (require.main === module) main();

module.exports = {
  REQUIRED_CONFIRMATION,
  REQUIRED_SECRET_NAMES,
  validateStaticConfiguration,
};
