jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP_SENTINEL',
      delete: () => 'DELETE_FIELD_SENTINEL',
      increment: (value) => ({ increment: value }),
    },
  },
  storage: jest.fn(),
  auth: jest.fn(),
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  logError: jest.fn(),
  shortHash: jest.fn(() => 'actorhash123'),
}));

const riskC = require('../../risk/constants');
const {
  pseudonymizeRiskProfile,
  runtimeUpdate,
} = require('../processDeletion');

function createRiskProfileDb({ exists = true } = {}) {
  const oldRef = {
    id: 'driver_raw-firebase-uid',
    get: jest.fn(async () => ({
      exists,
      data: () => ({
        actorType: 'driver',
        actorId: 'raw-firebase-uid',
        totalSignals: 7,
        openSignals: 2,
        lastReasonCode: 'IMPOSSIBLE_GPS_SPEED',
        lastSeverity: 'high',
        lastSignalAtMs: 900,
        lastSignalAt: 'OLD_TIMESTAMP',
        email: 'must-not-be-copied@example.com',
        arbitraryPrivateField: 'must-not-be-copied',
      }),
    })),
  };
  const newRef = { id: 'driver_deleted_driver_random' };
  const doc = jest.fn((id) => (
    id === 'driver_raw-firebase-uid' ? oldRef : newRef
  ));
  const collection = jest.fn((name) => {
    if (name !== riskC.COLLECTIONS.RISK_PROFILES) {
      throw new Error(`unexpected collection ${name}`);
    }
    return { doc };
  });
  const batch = {
    set: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn(async () => undefined),
  };

  return {
    db: {
      collection,
      batch: jest.fn(() => batch),
    },
    batch,
    oldRef,
    newRef,
    doc,
  };
}

describe('account deletion processor helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('converts policy timestamp markers to Firestore sentinels', () => {
    expect(runtimeUpdate({
      updatedAt: 'SERVER_TIMESTAMP',
      status: 'cancelled',
    })).toEqual({
      updatedAt: 'SERVER_TIMESTAMP_SENTINEL',
      status: 'cancelled',
    });
  });

  it('migrates a role-prefixed risk profile without copying arbitrary PII', async () => {
    const { db, batch, oldRef, newRef, doc } = createRiskProfileDb();

    const migrated = await pseudonymizeRiskProfile(
      db,
      'driver',
      'raw-firebase-uid',
      'deleted_driver_random',
    );

    expect(migrated).toBe(true);
    expect(doc).toHaveBeenNthCalledWith(1, 'driver_raw-firebase-uid');
    expect(doc).toHaveBeenNthCalledWith(2, 'driver_deleted_driver_random');
    expect(batch.set).toHaveBeenCalledWith(
      newRef,
      expect.objectContaining({
        actorType: 'driver',
        actorId: 'deleted_driver_random',
        totalSignals: 7,
        openSignals: 2,
        lastReasonCode: 'IMPOSSIBLE_GPS_SPEED',
        accountDeleted: true,
        accountDeletionPolicyVersion: 'account-deletion-2026.1',
      }),
      { merge: true },
    );
    const migratedData = batch.set.mock.calls[0][1];
    expect(migratedData).not.toHaveProperty('email');
    expect(migratedData).not.toHaveProperty('arbitraryPrivateField');
    expect(batch.delete).toHaveBeenCalledWith(oldRef);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the original risk profile does not exist', async () => {
    const { db, batch } = createRiskProfileDb({ exists: false });

    await expect(pseudonymizeRiskProfile(
      db,
      'passenger',
      'missing-uid',
      'deleted_passenger_random',
    )).resolves.toBe(false);

    expect(batch.set).not.toHaveBeenCalled();
    expect(batch.delete).not.toHaveBeenCalled();
    expect(batch.commit).not.toHaveBeenCalled();
  });
});
