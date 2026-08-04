const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadFirebaseBuildConfig,
  firebaseConfigFromGoogleServices,
} = require('../../../scripts/build/firebaseBuildConfig');

const temporaryDirectories = [];

function makeTempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drivelocal-firebase-'));
  temporaryDirectories.push(directory);
  return directory;
}

function googleServicesFixture({
  projectId = 'drivelocal-dev',
  projectNumber = '123456789',
  packageName = 'com.drivelocal.app',
} = {}) {
  return {
    project_info: {
      project_number: projectNumber,
      project_id: projectId,
      storage_bucket: `${projectId}.firebasestorage.app`,
    },
    client: [
      {
        client_info: {
          mobilesdk_app_id: `1:${projectNumber}:android:test-app-id`,
          android_client_info: {
            package_name: packageName,
          },
        },
        api_key: [
          {
            current_key: 'android-public-test-api-key',
          },
        ],
      },
    ],
    configuration_version: '1',
  };
}

function firebaseWebEnv({
  projectId = 'drivelocal-dev',
  projectNumber = '123456789',
  storageBucket = `${projectId}.firebasestorage.app`,
  appId = `1:${projectNumber}:web:test-web-app`,
} = {}) {
  return {
    EXPO_PUBLIC_FIREBASE_API_KEY: 'web-public-test-api-key',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: projectId,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: storageBucket,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: projectNumber,
    EXPO_PUBLIC_FIREBASE_APP_ID: appId,
  };
}

function writeGoogleServices(directory, fixture, filename = 'google-services.json') {
  const filePath = path.join(directory, filename);
  fs.writeFileSync(filePath, JSON.stringify(fixture), 'utf8');
  return filePath;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('Firebase Android/Web build environment separation', () => {
  it('accepts matching Android and Web DEV apps for a development EAS build', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    const result = loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'dev',
        EAS_BUILD: '1',
        ...firebaseWebEnv(),
      },
    });

    expect(result).toMatchObject({
      appEnvironment: 'development',
      easBuildActive: true,
      androidFirebaseProjectId: 'drivelocal-dev',
      androidFirebaseMatchesExpected: true,
      firebaseProjectId: 'drivelocal-dev',
      expectedProjectId: 'drivelocal-dev',
      firebaseWebConfigValidated: true,
      localEasConfigFallbackActive: false,
      source: 'environment-web-config',
    });
  });

  it('allows the checked-in DEV file only during local production EAS config resolution', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());
    const projectNumber = '987654321';

    const result = loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'prod',
        EAS_CONFIG_ALLOW_LOCAL_GOOGLE_SERVICES_FALLBACK: '1',
        ...firebaseWebEnv({
          projectId: 'drivelocal-prod',
          projectNumber,
        }),
      },
    });

    expect(result).toMatchObject({
      appEnvironment: 'production',
      easBuildActive: false,
      expectedProjectId: 'drivelocal-prod',
      androidFirebaseProjectId: 'drivelocal-dev',
      androidFirebaseMatchesExpected: false,
      firebaseProjectId: 'drivelocal-prod',
      firebaseWebConfigValidated: true,
      googleServicesFile: './google-services.json',
      localEasConfigFallbackActive: true,
      source: 'environment-web-config-local-android-fallback',
    });
  });

  it('rejects a production Web config with the DEV Android file outside the explicit local fallback', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'prod',
        ...firebaseWebEnv({
          projectId: 'drivelocal-prod',
          projectNumber: '987654321',
        }),
      },
    })).toThrow('expected drivelocal-prod');
  });

  it('requires the production file secret on the remote EAS worker', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture({
      projectId: 'drivelocal-prod',
      projectNumber: '987654321',
    }));

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'prod',
        EAS_BUILD: '1',
        EAS_CONFIG_ALLOW_LOCAL_GOOGLE_SERVICES_FALLBACK: '1',
        ...firebaseWebEnv({
          projectId: 'drivelocal-prod',
          projectNumber: '987654321',
        }),
      },
    })).toThrow('Production EAS build requires GOOGLE_SERVICES_JSON');
  });

  it('requires a Firebase Web App config for every EAS build', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'dev',
        EAS_BUILD: '1',
      },
    })).toThrow('requires the six EXPO_PUBLIC_FIREBASE_* values');
  });

  it('accepts matching Android and Web PROD apps on the remote worker', () => {
    const cwd = makeTempDirectory();
    const projectNumber = '987654321';
    const filePath = writeGoogleServices(
      cwd,
      googleServicesFixture({
        projectId: 'drivelocal-prod',
        projectNumber,
      }),
      'google-services-prod.json'
    );

    const result = loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'production',
        EAS_BUILD: '1',
        GOOGLE_SERVICES_JSON: filePath,
        ...firebaseWebEnv({
          projectId: 'drivelocal-prod',
          projectNumber,
        }),
      },
    });

    expect(result).toMatchObject({
      appEnvironment: 'production',
      easBuildActive: true,
      androidFirebaseProjectId: 'drivelocal-prod',
      androidFirebaseMatchesExpected: true,
      firebaseProjectId: 'drivelocal-prod',
      expectedProjectId: 'drivelocal-prod',
      firebaseWebConfigValidated: true,
      localEasConfigFallbackActive: false,
      source: 'environment-web-config',
    });
  });

  it('rejects a google-services client for a different Android package', () => {
    expect(() => firebaseConfigFromGoogleServices(
      googleServicesFixture({ packageName: 'com.example.other' }),
      'com.drivelocal.app'
    )).toThrow('No Android Firebase client for package com.drivelocal.app');
  });

  it('rejects a Web App from another Firebase project', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'dev',
        EAS_BUILD: '1',
        ...firebaseWebEnv({ projectId: 'other-project' }),
      },
    })).toThrow('expected drivelocal-dev');
  });

  it('rejects a Web App whose sender does not match the Android project number', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'dev',
        EAS_BUILD: '1',
        ...firebaseWebEnv({ projectNumber: '999999999' }),
      },
    })).toThrow('does not match Android project number 123456789');
  });

  it('rejects an Android App ID used as the Firebase JS appId', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'dev',
        EAS_BUILD: '1',
        ...firebaseWebEnv({
          appId: '1:123456789:android:test-android-app',
        }),
      },
    })).toThrow('must be a Firebase Web App ID');
  });

  it('rejects a partial Firebase Web configuration', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'dev',
        EAS_BUILD: '1',
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'drivelocal-dev',
      },
    })).toThrow('Firebase Web configuration is incomplete');
  });

  it('keeps ordinary local Expo commands usable with the checked-in DEV fallback', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    const result = loadFirebaseBuildConfig({ cwd, env: {} });

    expect(result).toMatchObject({
      appEnvironment: 'production',
      easBuildActive: false,
      expectedProjectId: 'drivelocal-prod',
      androidFirebaseProjectId: 'drivelocal-dev',
      androidFirebaseMatchesExpected: false,
      firebaseProjectId: 'drivelocal-dev',
      firebaseConfig: null,
      firebaseWebConfigValidated: false,
      localEasConfigFallbackActive: false,
      source: 'runtime-local-dev-fallback',
    });
  });
});
