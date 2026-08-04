const appJson = require('./app.json');
const { loadFirebaseBuildConfig } = require('./scripts/build/firebaseBuildConfig');
const { loadPublicPolicyConfig } = require('./scripts/build/publicPolicyConfig');
const {
  ensureDriverArrivalNotificationSound,
} = require('./scripts/build/ensureNotificationSounds');

const configDiagnosticsEnabled = ['1', 'true'].includes(
  String(process.env.APP_CONFIG_DEBUG || '').trim().toLowerCase()
);

function writeConfigDiagnostic(message) {
  // Expo/EAS config commands require clean JSON output. Diagnostics are opt-in so
  // PowerShell and EAS CLI do not interpret routine config traces as failures.
  if (!configDiagnosticsEnabled) return;
  process.stderr.write(`${String(message)}\n`);
}

const expoConfig = appJson.expo ?? {};
const driverArrivalNotificationSound = ensureDriverArrivalNotificationSound({
  cwd: __dirname,
});
const packageName = expoConfig.android?.package || 'com.drivelocal.app';
const firebaseBuild = loadFirebaseBuildConfig({
  env: process.env,
  cwd: __dirname,
  packageName,
  fallbackPath: expoConfig.android?.googleServicesFile || './google-services.json',
});
const {
  appEnvironment,
  easBuildActive,
  expectedProjectId,
  androidFirebaseProjectId,
  androidFirebaseMatchesExpected,
  firebaseConfig,
  firebaseProjectId,
  firebaseWebConfigValidated,
  googleServicesFile,
  localEasConfigFallbackActive,
  source: firebaseConfigSource,
} = firebaseBuild;
const publicPolicy = loadPublicPolicyConfig({
  env: process.env,
  appEnvironment,
  easBuildActive,
});

const googleMapsAndroidApiKey = String(process.env.GOOGLE_MAPS_ANDROID_API_KEY || '').trim();

if (!googleMapsAndroidApiKey) {
  const message =
    '[app.config] GOOGLE_MAPS_ANDROID_API_KEY is empty. Android Google Maps tiles '
    + 'will remain black until the key is provided and a new native Android build is created.';

  // Never publish an EAS binary that is known to contain an unusable Google map.
  // Local config commands keep working so the developer can add the variable and rebuild.
  if (easBuildActive) throw new Error(message);
  writeConfigDiagnostic(message);
}

if (!easBuildActive && androidFirebaseProjectId !== expectedProjectId) {
  // EAS CLI may use the checked-in DEV file while resolving the production config
  // locally. The remote worker still requires and validates the PROD file secret.
  writeConfigDiagnostic(
    `[app.config] Local Firebase Android fallback selected ${androidFirebaseProjectId} while `
    + `APP_ENV resolves to ${appEnvironment}; localEasFallback=${localEasConfigFallbackActive}.`
  );
}

if (!publicPolicy.configured) {
  // Missing public pages are allowed only outside production EAS. Never print the
  // supplied URLs themselves; configuration state is enough for build diagnostics.
  writeConfigDiagnostic(
    `[app.config] Public policy links incomplete missing=${publicPolicy.missing.join('|') || 'none'} `
    + `invalid=${publicPolicy.invalid.join('|') || 'none'}`
  );
}

// Safe opt-in build trace: public project identifiers and boolean states only.
// Never log API keys, app IDs, policy URLs, file contents or secret-file paths.
writeConfigDiagnostic(
  `[app.config] Firebase androidProject=${androidFirebaseProjectId} `
  + `webProject=${firebaseProjectId} environment=${appEnvironment} `
  + `source=${firebaseConfigSource} webValidated=${firebaseWebConfigValidated} `
  + `androidValidated=${androidFirebaseMatchesExpected} easBuild=${easBuildActive} `
  + `localEasFallback=${localEasConfigFallbackActive} `
  + `publicPolicyConfigured=${publicPolicy.configured} `
  + 'driverArrivalSoundConfigured=true'
);

const devRideSimulatorEnabled = appEnvironment === 'development'
  && process.env.ENABLE_DEV_RIDE_SIMULATOR === '1';

const managedPlugins = new Set([
  '@react-native-firebase/app',
  'expo-location',
  'expo-notifications',
  'expo-audio',
  'expo-secure-store',
  'expo-image',
  'expo-status-bar',
  'react-native-maps',
]);

const existingPlugins = (expoConfig.plugins ?? []).filter((plugin) => {
  const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
  return !managedPlugins.has(pluginName);
});

const mapsPlugin = googleMapsAndroidApiKey
  ? [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: googleMapsAndroidApiKey,
      },
    ]
  : 'react-native-maps';

module.exports = ({ config }) => ({
  ...config,
  ...expoConfig,

  plugins: [
    ...existingPlugins,

    '@react-native-firebase/app',

    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'O DriveLocal usa sua localização para encontrar corridas próximas e acompanhar a corrida.',
        locationAlwaysAndWhenInUsePermission:
          'Quando você fica disponível ou está em uma corrida, o DriveLocal usa sua localização em segundo plano para o despacho e para mostrar seu deslocamento ao passageiro. O rastreamento para quando você fica indisponível.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: './assets/images/notification-icon.png',
      },
    ],

    mapsPlugin,

    [
      'expo-notifications',
      {
        defaultChannel: 'drivelocal-ride-status',
        icon: './assets/images/notification-icon.png',
        color: '#2563EB',
        sounds: [driverArrivalNotificationSound],
      },
    ],

    [
      'expo-audio',
      {
        microphonePermission: false,
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],

    'expo-secure-store',
    'expo-image',
    'expo-status-bar',
  ],

  android: {
    ...(expoConfig.android ?? {}),
    // Local EAS config resolution may use the repository fallback. The remote
    // worker re-evaluates this field with GOOGLE_SERVICES_JSON from EAS secrets.
    googleServicesFile,
  },

  extra: {
    ...(expoConfig.extra ?? {}),
    googleMapsAndroidConfigured: Boolean(googleMapsAndroidApiKey),
    appEnvironment,
    devRideSimulatorEnabled,
    easBuildActive,
    firebaseBuildValidated:
      firebaseWebConfigValidated && androidFirebaseMatchesExpected,
    ...(firebaseConfig ? { firebaseConfig } : {}),
    firebaseProjectId,
    firebaseConfigSource,
    firebaseWebConfigValidated,
    androidFirebaseMatchesExpected,
    localEasConfigFallbackActive,
    publicPolicyConfigured: publicPolicy.configured,
    publicPolicyLinks: publicPolicy.links,
  },
});
