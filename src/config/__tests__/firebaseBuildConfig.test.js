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
      firebaseProjectId: 'drivelocal-dev',
      expectedProjectId: 'drivelocal-dev',
      firebaseWebConfigValidated: true,
      source: 'environment-web-config',
    });
    expect(result.firebaseConfig).toMatchObject({
      projectId: 'drivelocal-dev',
      authDomain: 'drivelocal-dev.firebaseapp.com',
      messagingSenderId: '123456789',
      appId: '1:123456789:web:test-web-app',
    });
  });

  it('requires an explicit google-services file for a production EAS build', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'prod',
        EAS_BUILD: '1',
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

  it('rejects the DEV Android project in a production EAS build', () => {
    const cwd = makeTempDirectory();
    const filePath = writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'prod',
        EAS_BUILD: 'true',
        GOOGLE_SERVICES_JSON: filePath,
        ...firebaseWebEnv(),
      },
    })).toThrow('expected drivelocal-prod');
  });

  it('accepts matching Android and Web PROD apps in a production EAS build', () => {
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
      firebaseProjectId: 'drivelocal-prod',
      expectedProjectId: 'drivelocal-prod',
      firebaseWebConfigValidated: true,
      source: 'environment-web-config',
    });
    expect(result.firebaseConfig.appId).toBe(`1:${projectNumber}:web:test-web-app`);
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
    })).toThrow('does not match Android project drivelocal-dev');
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

  it('keeps local Expo commands usable with the checked-in DEV Web fallback', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    const result = loadFirebaseBuildConfig({
      cwd,
      env: {},
    });

    // Missing APP_ENV keeps production UI behavior, while non-EAS local runtime
    // falls back to the checked-in DEV Web config. Store binaries never can.
    expect(result).toMatchObject({
      appEnvironment: 'production',
      easBuildActive: false,
      expectedProjectId: 'drivelocal-prod',
      androidFirebaseProjectId: 'drivelocal-dev',
      firebaseProjectId: 'drivelocal-dev',
      firebaseConfig: null,
      firebaseWebConfigValidated: false,
      source: 'runtime-local-dev-fallback',
    });
  });
});
