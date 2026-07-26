const mockStorage = new Map();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockStorage.set(key, value); }),
  removeItem: jest.fn(async (key) => { mockStorage.delete(key); }),
  multiRemove: jest.fn(async (keys) => { keys.forEach((key) => mockStorage.delete(key)); }),
}));

const mockGetIdToken = jest.fn(async () => 'TOKEN');
jest.mock('../../config/firebase', () => ({
  auth: {
    currentUser: {
      uid: 'user-1',
      getIdToken: mockGetIdToken,
    },
  },
}));

const {
  __resetNetworkRecoveryForTests,
  getNetworkRecoveryState,
  runRecoverableAction,
} = require('../networkRecoveryService');

function unavailableError() {
  const error = new Error('network down');
  error.code = 'functions/unavailable';
  return error;
}

function businessError() {
  const error = new Error('invalid state');
  error.code = 'functions/failed-precondition';
  return error;
}

describe('network recovery service', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    mockStorage.clear();
    await __resetNetworkRecoveryForTests();
  });

  it('keeps the idempotency key after an uncertain failure and reuses it only on a manual call', async () => {
    const keys = [];
    const firstExecute = jest.fn(async (key) => {
      keys.push(key);
      throw unavailableError();
    });

    await expect(runRecoverableAction({
      actionName: 'finishRideSecure',
      actionKey: 'ride-1:default',
      idempotencyPrefix: 'lc',
      execute: firstExecute,
    })).rejects.toMatchObject({ code: 'functions/unavailable' });

    // No background replay exists: execute ran exactly once and only this explicit
    // second call is allowed to contact the server again.
    expect(firstExecute).toHaveBeenCalledTimes(1);
    expect(getNetworkRecoveryState().status).toBe('offline');

    const secondExecute = jest.fn(async (key) => {
      keys.push(key);
      return { status: 'awaiting_payment' };
    });
    await expect(runRecoverableAction({
      actionName: 'finishRideSecure',
      actionKey: 'ride-1:default',
      idempotencyPrefix: 'lc',
      execute: secondExecute,
    })).resolves.toEqual({ status: 'awaiting_payment' });

    expect(secondExecute).toHaveBeenCalledTimes(1);
    expect(keys[1]).toBe(keys[0]);
    expect(getNetworkRecoveryState().status).toBe('online');
  });

  it('clears a definitive business rejection so a later legitimate attempt gets a new key', async () => {
    const keys = [];
    await expect(runRecoverableAction({
      actionName: 'startRideSecure',
      actionKey: 'ride-2:default',
      idempotencyPrefix: 'lc',
      execute: async (key) => {
        keys.push(key);
        throw businessError();
      },
    })).rejects.toMatchObject({ code: 'functions/failed-precondition' });

    await runRecoverableAction({
      actionName: 'startRideSecure',
      actionKey: 'ride-2:default',
      idempotencyPrefix: 'lc',
      execute: async (key) => {
        keys.push(key);
        return { status: 'in_progress' };
      },
    });

    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });
});
