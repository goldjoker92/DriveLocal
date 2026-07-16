const fs = require("fs");
const path = require("path");
const appJson = require("./app.json");

const expoConfig = appJson.expo ?? {};

const managedPluginNames = new Set([
  "expo-notifications",
  "expo-location",
  "expo-audio",
  "expo-secure-store",
  "expo-image",
  "expo-status-bar",
]);

const existingPlugins = (expoConfig.plugins ?? []).filter((plugin) => {
  const name = Array.isArray(plugin) ? plugin[0] : plugin;
  return !managedPluginNames.has(name);
});

const exists = (relativePath) =>
  fs.existsSync(path.join(__dirname, relativePath));

const notificationIcon = "./assets/notification-icon.png";
const notificationSound = "./assets/sounds/new-ride.wav";

const notificationsOptions = {
  color: process.env.EXPO_PUBLIC_NOTIFICATION_COLOR ?? "#0F172A",
  defaultChannel: "ride-requests",
  ...(exists(notificationIcon) ? { icon: notificationIcon } : {}),
  ...(exists(notificationSound) ? { sounds: [notificationSound] } : {}),
};

const androidMapsApiKey =
  process.env.GOOGLE_MAPS_ANDROID_API_KEY ??
  expoConfig.android?.config?.googleMaps?.apiKey;

const iosMapsApiKey =
  process.env.GOOGLE_MAPS_IOS_API_KEY ??
  expoConfig.ios?.config?.googleMapsApiKey;

module.exports = ({ config }) => ({
  ...config,
  ...expoConfig,

  scheme: process.env.APP_SCHEME ?? expoConfig.scheme ?? "drivelocal",

  plugins: [
    ...existingPlugins,

    ["expo-notifications", notificationsOptions],

    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "DriveLocal utilise votre position pour afficher les chauffeurs proches, calculer les trajets et réaliser les courses.",
        locationAlwaysAndWhenInUsePermission:
          "DriveLocal utilise votre position en arrière-plan uniquement lorsque vous êtes chauffeur disponible ou pendant une course.",
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
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

    [
      "expo-secure-store",
      {
        configureAndroidBackup: true,
        faceIDPermission:
          "DriveLocal utilise Face ID pour sécuriser l'accès à votre compte.",
      },
    ],

    "expo-image",

    [
      "expo-status-bar",
      {
        hidden: false,
        style: "dark",
      },
    ],
  ],

  android: {
    ...(expoConfig.android ?? {}),

    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ??
      expoConfig.android?.googleServicesFile ??
      "./google-services.json",

    config: {
      ...(expoConfig.android?.config ?? {}),
      ...(androidMapsApiKey
        ? {
            googleMaps: {
              ...(expoConfig.android?.config?.googleMaps ?? {}),
              apiKey: androidMapsApiKey,
            },
          }
        : {}),
    },
  },

  ios: {
    ...(expoConfig.ios ?? {}),

    ...(process.env.GOOGLE_SERVICES_IOS_PLIST ||
    expoConfig.ios?.googleServicesFile
      ? {
          googleServicesFile:
            process.env.GOOGLE_SERVICES_IOS_PLIST ??
            expoConfig.ios?.googleServicesFile,
        }
      : {}),

    config: {
      ...(expoConfig.ios?.config ?? {}),
      ...(iosMapsApiKey ? { googleMapsApiKey: iosMapsApiKey } : {}),
    },
  },

  extra: {
    ...(expoConfig.extra ?? {}),
    appEnvironment: process.env.APP_ENV ?? "development",
  },
});
