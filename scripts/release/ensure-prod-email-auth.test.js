'use strict';

const {
  EXPECTED_PROJECT_ID,
  REQUIRED_CONFIRMATION,
  authInitializeUrl,
  ensureProdEmailAuth,
} = require('./ensure-prod-email-auth');

function makeResponse(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? '' : JSON.stringify(body)),
  };
}

function readyConfig() {
  return {
    signIn: {
      email: {
        enabled: true,
        passwordRequired: true,
      },
    },
    client: {
      permissions: {
        disabledUserSignup: false,
      },
    },
  };
}

function dependencies(fetchImpl) {
  return {
    env: {
      CONFIRM_PRODUCTION_AUTH_CONFIG: REQUIRED_CONFIRMATION,
    },
    fetchImpl,
    loadBuildConfig: jest.fn(() => ({ firebaseProjectId: EXPECTED_PROJECT_ID })),
    getAccessToken: jest.fn(async () => 'access-token'),
    sleepImpl: jest.fn(async () => undefined),
    logger: {
      log: jest.fn(),
    },
  };
}

describe('ensureProdEmailAuth', () => {
  test('initializes a missing Auth configuration, enables Email/Password and verifies signup', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeResponse(404, {
        error: {
          status: 'NOT_FOUND',
          message: 'CONFIGURATION_NOT_FOUND',
        },
      }))
      .mockResolvedValueOnce(makeResponse(200, null))
      .mockResolvedValueOnce(makeResponse(200, {
        signIn: { email: { enabled: false, passwordRequired: false } },
        client: { permissions: { disabledUserSignup: true } },
      }))
      .mockResolvedValueOnce(makeResponse(200, readyConfig()))
      .mockResolvedValueOnce(makeResponse(200, readyConfig()));

    const options = dependencies(fetchImpl);
    await ensureProdEmailAuth(options);

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls[1][0]).toBe(authInitializeUrl(EXPECTED_PROJECT_ID));
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(fetchImpl.mock.calls[3][1]).toMatchObject({ method: 'PATCH' });
    expect(options.logger.log).toHaveBeenCalledWith(
      '[PROD_AUTH_CONFIG] configuration missing; initializing Firebase Authentication'
    );
    expect(options.logger.log).toHaveBeenCalledWith(
      '[PROD_AUTH_CONFIG] project=drivelocal-prod email_password=enabled signup=enabled REPAIRED'
    );
  });

  test('accepts an already initialized concurrent configuration', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeResponse(404, {
        error: { message: 'CONFIGURATION_NOT_FOUND' },
      }))
      .mockResolvedValueOnce(makeResponse(409, {
        error: { status: 'ALREADY_EXISTS', message: 'ALREADY_EXISTS' },
      }))
      .mockResolvedValueOnce(makeResponse(200, readyConfig()));

    const options = dependencies(fetchImpl);
    await ensureProdEmailAuth(options);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(options.logger.log).toHaveBeenCalledWith(
      '[PROD_AUTH_CONFIG] project=drivelocal-prod email_password=enabled signup=enabled OK'
    );
  });

  test('does not mutate an already ready production configuration', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(makeResponse(200, readyConfig()));
    const options = dependencies(fetchImpl);

    await ensureProdEmailAuth(options);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(options.logger.log).toHaveBeenCalledWith(
      '[PROD_AUTH_CONFIG] project=drivelocal-prod email_password=enabled signup=enabled OK'
    );
  });

  test('refuses execution without the explicit production confirmation', async () => {
    const fetchImpl = jest.fn();

    await expect(ensureProdEmailAuth({
      ...dependencies(fetchImpl),
      env: {},
    })).rejects.toThrow(
      'production Auth mutation requires CONFIRM_PRODUCTION_AUTH_CONFIG=DRIVELOCAL_PRODUCTION'
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
