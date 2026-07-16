$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package.json") -or -not (Test-Path ".\app.json")) {
  throw "Lance ce script depuis la racine de DriveLocal, là où se trouvent package.json et app.json."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (Test-Path ".\app.config.js") {
  Copy-Item ".\app.config.js" ".\app.config.js.backup-$timestamp"
  Write-Host "Sauvegarde créée : app.config.js.backup-$timestamp" -ForegroundColor Yellow
}

$appConfig = @'
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
'@

Set-Content -Path ".\app.config.js" -Value $appConfig -Encoding UTF8

if (-not (Test-Path ".\.env.example")) {
  $envExample = @'
APP_ENV=development
APP_SCHEME=drivelocal

EXPO_PUBLIC_API_URL=https://api-dev.drivelocal.com.br
EXPO_PUBLIC_WEB_URL=https://drivelocal.com.br
EXPO_PUBLIC_SUPPORT_EMAIL=suporte@drivelocal.com.br
EXPO_PUBLIC_PRIVACY_URL=https://drivelocal.com.br/privacidade
EXPO_PUBLIC_TERMS_URL=https://drivelocal.com.br/termos
EXPO_PUBLIC_NOTIFICATION_COLOR=#0F172A

GOOGLE_MAPS_ANDROID_API_KEY=
GOOGLE_MAPS_IOS_API_KEY=

GOOGLE_SERVICES_JSON=./google-services.json
GOOGLE_SERVICES_IOS_PLIST=./GoogleService-Info.plist
'@
  Set-Content -Path ".\.env.example" -Value $envExample -Encoding UTF8
}

New-Item -ItemType Directory -Force ".\assets\sounds" | Out-Null

$gitIgnoreEntries = @(
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.preview.local",
  ".env.production.local"
)

if (-not (Test-Path ".\.gitignore")) {
  New-Item -ItemType File ".\.gitignore" | Out-Null
}

$currentGitIgnore = Get-Content ".\.gitignore" -Raw
foreach ($entry in $gitIgnoreEntries) {
  if ($currentGitIgnore -notmatch "(?m)^$([regex]::Escape($entry))$") {
    Add-Content ".\.gitignore" $entry
  }
}

Write-Host ""
Write-Host "Configuration native écrite. Vérifications Expo en cours..." -ForegroundColor Green

npx expo config --type public
if ($LASTEXITCODE -ne 0) { throw "expo config a échoué." }

npx expo install --check
if ($LASTEXITCODE -ne 0) { throw "expo install --check a échoué." }

npx expo-doctor@latest
if ($LASTEXITCODE -ne 0) {
  Write-Host "expo-doctor signale un problème : corrige-le avant le build." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Tout est prêt pour le prebuild Android." -ForegroundColor Green
Write-Host "Commande suivante : npx expo prebuild --clean --platform android"
