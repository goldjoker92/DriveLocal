jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  shortHash: (value) => `hash_${String(value).slice(0, 6)}`,
}));

const mockWriteAuditLog = jest.fn(async () => 'audit-1');
jest.mock('../../audit/auditLog', () => ({
  writeAuditLog: (...args) => mockWriteAuditLog(...args),
}));

const { updateAdminAlert } = require('../alerts');

function createDb() {
  const documents = new Map([
    ['admins/admin-1', { role: 'admin' }],
    ['adminAlerts/alert-1', {
      alertId: 'alert-1',
      alertType: 'ride_payment_dispute',
      severity: 'high',
      status: 'open',
      resolutionCode: null,
      sourceActive: true,
      updatedAtMs: 100,
    }],
  ]);

  function ref(collectionName, id) {
    const path = `${collectionName}/${id}`;
    return {
      id,
      path,
      async get() {
        const value = documents.get(path);
        return { exists: value !== undefined, id, data: () => value };
      },
    };
  }

  const tx = {
    get: jest.fn((documentRef) => documentRef.get()),
    set: jest.fn((documentRef, value, options) => {
      const before = documents.get(documentRef.path) || {};
      documents.set(documentRef.path, options?.merge ? { ...before, ...value } : { ...value });
    }),
  };

  return {
    db: {
      collection: (collectionName) => ({ doc: (id) => ref(collectionName, id) }),
      runTransaction: (handler) => handler(tx),
    },
    documents,
    tx,
  };
}

function request(data, uid = 'admin-1') {
  return { auth: { uid }, data };
}

describe('updateAdminAlert', () => {
  beforeEach(() => mockWriteAuditLog.mockClear());

  it('acknowledges and resolves with predefined codes and an audit', async () => {
    const store = createDb();
    const acknowledged = await updateAdminAlert({
      db: store.db,
      request: request({
        alertId: 'alert-1',
        status: 'acknowledged',
        idempotencyKey: 'admin-alert-key-0001',
      }),
      context: { traceId: 'trace-alert-admin' },
      clock: { now: () => 2_000 },
    });
    expect(acknowledged).toMatchObject({
      alert: { alertId: 'alert-1', status: 'acknowledged' },
      replay: false,
    });

    const resolved = await updateAdminAlert({
      db: store.db,
      request: request({
        alertId: 'alert-1',
        status: 'resolved',
        resolutionCode: 'action_completed',
        idempotencyKey: 'admin-alert-key-0002',
      }),
      context: { traceId: 'trace-alert-admin' },
      clock: { now: () => 3_000 },
    });
    expect(resolved).toMatchObject({
      alert: {
        alertId: 'alert-1',
        status: 'resolved',
        resolutionCode: 'action_completed',
        resolvedAtMs: 3_000,
      },
      replay: false,
    });
    expect(store.documents.get('adminAlerts/alert-1')).toMatchObject({
      status: 'resolved',
      resolutionCode: 'action_completed',
      resolvedBy: 'admin',
    });
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(2);
  });

  it('requires a resolution code and rejects non-admin callers', async () => {
    const store = createDb();
    await expect(updateAdminAlert({
      db: store.db,
      request: request({
        alertId: 'alert-1',
        status: 'resolved',
        idempotencyKey: 'admin-alert-key-0003',
      }),
      context: {},
      clock: { now: () => 2_000 },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await expect(updateAdminAlert({
      db: store.db,
      request: request({
        alertId: 'alert-1',
        status: 'acknowledged',
        idempotencyKey: 'admin-alert-key-0004',
      }, 'not-admin'),
      context: {},
      clock: { now: () => 2_000 },
    })).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
});
