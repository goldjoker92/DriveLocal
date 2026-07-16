const appJson = require("./app.json");

const expoConfig = appJson.expo ?? {};

const managedPlugins = new Set([
  "@react-native-firebase/app",
  "expo-location",
  "expo-notifications",
  "expo-audio",
  "expo-secure-store",
  "expo-image",
  "expo-status-bar",
]);

const existingPlugins = (expoConfig.plugins ?? []).filter((plugin) => {
  const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
  return !managedPlugins.has(pluginName);
});

module.exports = ({ config }) => ({
  ...config,
  ...expoConfig,

  plugins: [
    ...existingPlugins,

    "@react-native-firebase/app",

    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "DriveLocal utilise votre position pour rechercher et réaliser des courses.",
        locationAlwaysAndWhenInUsePermission:
          "DriveLocal utilise votre position en arrière-plan lorsque vous êtes chauffeur disponible ou pendant une course.",
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],

    [
      "expo-notifications",
      {
        defaultChannel: "ride-requests",
        color: "#0F172A",
      },
    ],

    [
      "expo-audio",
      {
        microphonePermission: false,
        recordAudioAndroid: false,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],

    "expo-secure-store",
    "expo-image",
    "expo-status-bar",
  ],

  android: {
    ...(expoConfig.android ?? {}),

    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ??
      expoConfig.android?.googleServicesFile ??
      "./google-services.json",
  },
});
