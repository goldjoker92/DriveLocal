'use strict';

const {
  ANDROID_PACKAGE,
  EXPECTED_PROJECT_ID,
  loadProdFirebaseAndroidConfig,
} = require('./prodFirebaseAndroidConfig');

function androidConfig(projectId = EXPECTED_PROJECT_ID) {
  return {
    apiKey: 'android-api-key',
    appId: '1:1234567890:android:abcdef',
    packageName: ANDROID_PACKAGE,
    projectId,
    projectNumber: '1234567890',
    storageBucket: `${projectId}.appspot.com`,
  };
}

describe('loadProdFirebaseAndroidConfig', () => {
  test('loads the protected Android config without Firebase Web build variables', () => {
    const readGoogleServices = jest.fn(() => ({
      parsed: { project_info: { project_id: EXPECTED_PROJECT_ID } },
      resolvedPath: '/protected/google-services.prod.json',
    }));
    const configFromGoogleServices = jest.fn(() => androidConfig());

    const result = loadProdFirebaseAndroidConfig({
      env: { GOOGLE_SERVICES_JSON: '/protected/google-services.prod.json' },
      cwd: '/workspace',
      readGoogleServices,
      configFromGoogleServices,
    });

    expect(readGoogleServices).toHaveBeenCalledWith(
      '/protected/google-services.prod.json',
      '/workspace'
    );
    expect(configFromGoogleServices).toHaveBeenCalledWith(
      { project_info: { project_id: EXPECTED_PROJECT_ID } },
      ANDROID_PACKAGE
    );
    expect(result).toEqual(expect.objectContaining({
      projectId: EXPECTED_PROJECT_ID,
      apiKey: 'android-api-key',
      googleServicesResolvedPath: '/protected/google-services.prod.json',
    }));
  });

  test('refuses a Firebase Android file from any other project', () => {
    expect(() => loadProdFirebaseAndroidConfig({
      env: { GOOGLE_SERVICES_JSON: '/protected/google-services.dev.json' },
      readGoogleServices: () => ({ parsed: {}, resolvedPath: '/protected/google-services.dev.json' }),
      configFromGoogleServices: () => androidConfig('drivelocal-dev'),
    })).toThrow('refusing project drivelocal-dev; expected drivelocal-prod');
  });

  test('requires an explicit protected google-services file', () => {
    expect(() => loadProdFirebaseAndroidConfig({ env: {} }))
      .toThrow('missing GOOGLE_SERVICES_JSON');
  });
});
