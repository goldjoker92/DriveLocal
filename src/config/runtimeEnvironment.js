import Constants from 'expo-constants';

// Runtime flags are injected by app.config.js at native build time. Unknown or
// incomplete configuration fails closed: production behavior and no DEV tools.
function readExtra() {
  return Constants.expoConfig?.extra
    || Constants.manifest?.extra
    || Constants.manifest2?.extra?.expoClient?.extra
    || {};
}

const extra = readExtra();

export const APP_ENVIRONMENT = extra.appEnvironment === 'development'
  ? 'development'
  : 'production';

export const IS_PRODUCTION_BUILD = APP_ENVIRONMENT === 'production';

// This requires BOTH a development build and the explicit simulator flag.
// A production build can never enable the simulator through remote data,
// Firestore content, a hidden gesture, or a user-controlled setting.
export const DEV_RIDE_SIMULATOR_ENABLED = APP_ENVIRONMENT === 'development'
  && extra.devRideSimulatorEnabled === true;
