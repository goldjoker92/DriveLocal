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
            current_key: 'public-test-api-key',
          },
        ],
      },
    ],
    configuration_version: '1',
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

describe('Firebase build environment separation', () => {
  it('accepts the checked-in DEV project for a development EAS build', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    const result = loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'dev',
        EAS_BUILD: '1',
      },
    });

    expect(result).toMatchObject({
      appEnvironment: 'development',
      easBuildActive: true,
      firebaseProjectId: 'drivelocal-dev',
      expectedProjectId: 'drivelocal-dev',
      source: 'repository-fallback',
    });
    expect(result.firebaseConfig).toMatchObject({
      projectId: 'drivelocal-dev',
      authDomain: 'drivelocal-dev.firebaseapp.com',
      messagingSenderId: '123456789',
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
      },
    })).toThrow('Production EAS build requires GOOGLE_SERVICES_JSON');
  });

  it('rejects the DEV Firebase project in a production EAS build', () => {
    const cwd = makeTempDirectory();
    const filePath = writeGoogleServices(cwd, googleServicesFixture());

    expect(() => loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'prod',
        EAS_BUILD: 'true',
        GOOGLE_SERVICES_JSON: filePath,
      },
    })).toThrow('expected drivelocal-prod');
  });

  it('accepts the PROD Firebase project in a production EAS build', () => {
    const cwd = makeTempDirectory();
    const filePath = writeGoogleServices(
      cwd,
      googleServicesFixture({ projectId: 'drivelocal-prod' }),
      'google-services-prod.json'
    );

    const result = loadFirebaseBuildConfig({
      cwd,
      env: {
        APP_ENV: 'production',
        EAS_BUILD: '1',
        GOOGLE_SERVICES_JSON: filePath,
      },
    });

    expect(result).toMatchObject({
      appEnvironment: 'production',
      easBuildActive: true,
      firebaseProjectId: 'drivelocal-prod',
      expectedProjectId: 'drivelocal-prod',
      source: 'environment-file',
    });
    expect(result.firebaseConfig.projectId).toBe('drivelocal-prod');
  });

  it('rejects a google-services client for a different Android package', () => {
    expect(() => firebaseConfigFromGoogleServices(
      googleServicesFixture({ packageName: 'com.example.other' }),
      'com.drivelocal.app'
    )).toThrow('No Android Firebase client for package com.drivelocal.app');
  });

  it('keeps local Expo commands usable with the DEV fallback outside EAS', () => {
    const cwd = makeTempDirectory();
    writeGoogleServices(cwd, googleServicesFixture());

    const result = loadFirebaseBuildConfig({
      cwd,
      env: {},
    });

    // Missing APP_ENV keeps production UI behavior, but a non-EAS local command
    // may still use the repository DEV database. Store binaries never get this exception.
    expect(result).toMatchObject({
      appEnvironment: 'production',
      easBuildActive: false,
      expectedProjectId: 'drivelocal-prod',
      firebaseProjectId: 'drivelocal-dev',
    });
  });
});
