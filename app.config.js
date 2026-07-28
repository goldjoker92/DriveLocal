const appJson = require('./app.json');
const { loadFirebaseBuildConfig } = require('./scripts/build/firebaseBuildConfig');
const { loadPublicPolicyConfig } = require('./scripts/build/publicPolicyConfig');

function writeConfigDiagnostic(message) {
  // Expo/EAS commands may evaluate app.config.js through a child process whose
  // stdout must contain JSON only. Diagnostics belong on stderr so commands such
  // as `eas env:*`, `eas config --json` and fingerprints cannot be corrupted.
  process.stderr.write(`${String(message)}\n`);
}

const expoConfig = appJson.expo ?? {};
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
  firebaseConfig,
  firebaseProjectId,
  googleServicesFile,
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

if (!easBuildActive && firebaseProjectId !== expectedProjectId) {
  // Local commands intentionally remain usable with the checked-in DEV file even
  // when APP_ENV is absent and UI behavior fails closed to production. EAS builds
  // can never use this exception; scripts/build/firebaseBuildConfig.js blocks it.
  writeConfigDiagnostic(
    `[app.config] Local Firebase fallback selected ${firebaseProjectId} while `
    + `APP_ENV resolves to ${appEnvironment}. EAS builds remain strict.`
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

// Safe build trace: project identifiers and boolean configuration states only.
// Never log API keys, app IDs, policy URLs, file contents or secret-file paths.
writeConfigDiagnostic(
  `[app.config] Firebase project=${firebaseProjectId} environment=${appEnvironment} `
  + `source=${firebaseConfigSource} easBuild=${easBuildActive} `
  + `publicPolicyConfigured=${publicPolicy.configured}`
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
    // The exact same file is parsed above to configure the Firebase JS SDK.
    // This prevents native Firebase and JS Firebase from targeting different projects.
    googleServicesFile,
  },

  extra: {
    ...(expoConfig.extra ?? {}),
    googleMapsAndroidConfigured: Boolean(googleMapsAndroidApiKey),
    appEnvironment,
    devRideSimulatorEnabled,
    easBuildActive,
    firebaseBuildValidated: true,
    firebaseConfig,
    firebaseProjectId,
    firebaseConfigSource,
    publicPolicyConfigured: publicPolicy.configured,
    publicPolicyLinks: publicPolicy.links,
  },
});
