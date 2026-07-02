const appJson = require("./app.json");

const expoConfig = appJson.expo;

module.exports = ({ config }) => ({
  ...config,
  ...expoConfig,
  android: {
    ...expoConfig.android,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
  },
});
