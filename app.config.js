const appJson = require('./app.json');

const expoConfig = appJson.expo ?? {};
const googleMapsAndroidApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || '';
const appEnvironment = process.env.APP_ENV === 'prod' ? 'production' : 'development';
const devRideSimulatorEnabled = appEnvironment === 'development'
  && process.env.ENABLE_DEV_RIDE_SIMULATOR !== '0';

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

    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ??
      expoConfig.android?.googleServicesFile ??
      './google-services.json',
  },

  extra: {
    ...(expoConfig.extra ?? {}),
    googleMapsAndroidConfigured: Boolean(googleMapsAndroidApiKey),
    appEnvironment,
    devRideSimulatorEnabled,
  },
});
