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
  shortHash: (value) => `hash_${String(value).slice(0, 8)}`,
}));

jest.mock('../../audit/auditLog', () => ({ writeAuditLog: jest.fn() }));

const { SOURCE_TYPE, STATUS } = require('../policy');
const { syncAdminAlert, alertDocumentId } = require('../alerts');

function createDb() {
  const documents = new Map();

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

describe('syncAdminAlert', () => {
  it('creates once, ignores an identical replay, resolves and reopens deterministically', async () => {
    const store = createDb();
    const clock = { now: jest.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000) };
    const args = {
      db: store.db,
      sourceType: SOURCE_TYPE.RIDE_DISPUTE,
      sourceId: 'ride-1',
      context: { traceId: 'trace-alert' },
      clock,
    };

    const created = await syncAdminAlert({
      ...args,
      sourceData: {
        rideId: 'ride-1',
        status: 'disputed',
        paymentAmountCentavos: 1500,
        passengerId: 'PRIVATE_PASSENGER',
      },
    });
    expect(created.action).toBe('created');

    const alertId = alertDocumentId(SOURCE_TYPE.RIDE_DISPUTE, 'ride-1');
    const path = `adminAlerts/${alertId}`;
    expect(store.documents.get(path)).toMatchObject({
      alertId,
      status: STATUS.OPEN,
      alertType: 'ride_payment_dispute',
      occurrenceCount: 1,
      targetId: 'ride-1',
      amountCentavos: 1500,
      sourceActive: true,
    });
    expect(JSON.stringify(store.documents.get(path))).not.toContain('PRIVATE_PASSENGER');

    const replay = await syncAdminAlert({
      ...args,
      sourceData: {
        rideId: 'ride-1',
        status: 'disputed',
        paymentAmountCentavos: 1500,
      },
    });
    expect(replay.action).toBe('noop');
    expect(store.documents.get(path).occurrenceCount).toBe(1);

    const resolved = await syncAdminAlert({
      ...args,
      sourceData: { rideId: 'ride-1', status: 'completed' },
    });
    expect(resolved.action).toBe('resolved');
    expect(store.documents.get(path)).toMatchObject({
      status: STATUS.RESOLVED,
      resolutionCode: 'source_resolved',
      sourceActive: false,
    });

    const reopened = await syncAdminAlert({
      ...args,
      sourceData: {
        rideId: 'ride-1',
        status: 'disputed',
        paymentAmountCentavos: 1500,
      },
    });
    expect(reopened.action).toBe('reopened');
    expect(store.documents.get(path)).toMatchObject({
      status: STATUS.OPEN,
      resolutionCode: null,
      occurrenceCount: 2,
      sourceActive: true,
    });
  });

  it('marks an admin-resolved source inactive without replacing the admin resolution', async () => {
    const store = createDb();
    const clock = { now: jest.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000) };
    const args = {
      db: store.db,
      sourceType: SOURCE_TYPE.RIDE_DISPUTE,
      sourceId: 'ride-admin-resolved',
      context: { traceId: 'trace-admin-resolved' },
      clock,
    };

    await syncAdminAlert({
      ...args,
      sourceData: {
        rideId: 'ride-admin-resolved',
        status: 'disputed',
        paymentAmountCentavos: 2200,
      },
    });
    const alertId = alertDocumentId(SOURCE_TYPE.RIDE_DISPUTE, 'ride-admin-resolved');
    const path = `adminAlerts/${alertId}`;
    store.documents.set(path, {
      ...store.documents.get(path),
      status: STATUS.RESOLVED,
      resolutionCode: 'action_completed',
      resolvedBy: 'admin',
      sourceActive: true,
    });

    const sourceClosed = await syncAdminAlert({
      ...args,
      sourceData: { rideId: 'ride-admin-resolved', status: 'completed' },
    });
    expect(sourceClosed.action).toBe('source_inactive');
    expect(store.documents.get(path)).toMatchObject({
      status: STATUS.RESOLVED,
      resolutionCode: 'action_completed',
      resolvedBy: 'admin',
      sourceActive: false,
    });

    const reopened = await syncAdminAlert({
      ...args,
      sourceData: {
        rideId: 'ride-admin-resolved',
        status: 'disputed',
        paymentAmountCentavos: 2200,
      },
    });
    expect(reopened.action).toBe('reopened');
    expect(store.documents.get(path)).toMatchObject({
      status: STATUS.OPEN,
      resolutionCode: null,
      resolvedBy: null,
      sourceActive: true,
    });
  });
});
