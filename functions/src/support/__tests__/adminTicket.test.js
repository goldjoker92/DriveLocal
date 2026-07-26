jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      delete: () => 'DELETE_FIELD',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  shortHash: jest.fn(),
}));

const writeAuditLog = jest.fn(async () => 'audit-1');
jest.mock('../../audit/auditLog', () => ({
  writeAuditLog: (...args) => writeAuditLog(...args),
}));

const { updateAdminSupportTicket } = require('../tickets');

function createDb() {
  const documents = new Map([
    ['admins/admin-1', { role: 'admin' }],
    ['supportTickets/ticket-1', {
      ticketId: 'ticket-1',
      actorUid: 'passenger-1',
      actorRole: 'passenger',
      categoryCode: 'fare_payment_issue',
      status: 'open',
      resolutionCode: null,
      createdAtMs: 100,
    }],
  ]);

  function ref(collectionName, id) {
    const path = `${collectionName}/${id}`;
    return {
      id,
      path,
      async get() {
        const value = documents.get(path);
        return { exists: value !== undefined, data: () => value };
      },
    };
  }

  const tx = {
    get: jest.fn(async (documentRef) => documentRef.get()),
    set: jest.fn((documentRef, value, options) => {
      const before = documents.get(documentRef.path) || {};
      documents.set(documentRef.path, options?.merge ? { ...before, ...value } : { ...value });
    }),
  };

  return {
    db: {
      collection: jest.fn((collectionName) => ({
        doc: (id) => ref(collectionName, id),
      })),
      runTransaction: jest.fn(async (handler) => handler(tx)),
    },
    tx,
    get: (path) => documents.get(path),
  };
}

describe('admin support ticket transition', () => {
  beforeEach(() => writeAuditLog.mockClear());

  it('resolves a ticket with a predefined resolution and audit', async () => {
    const store = createDb();
    const result = await updateAdminSupportTicket({
      db: store.db,
      request: {
        auth: { uid: 'admin-1' },
        data: {
          ticketId: 'ticket-1',
          status: 'resolved',
          resolutionCode: 'payment_under_review',
          idempotencyKey: 'support-admin-key-0001',
        },
      },
      context: { traceId: 'trace-admin-support' },
      clock: { now: () => 2_000_000 },
    });

    expect(result).toMatchObject({
      ticketId: 'ticket-1',
      status: 'resolved',
      resolutionCode: 'payment_under_review',
      replay: false,
    });
    expect(store.get('supportTickets/ticket-1')).toMatchObject({
      status: 'resolved',
      resolutionCode: 'payment_under_review',
      adminUpdatedAtMs: 2_000_000,
      updatedAtMs: 2_000_000,
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      store.db,
      expect.objectContaining({
        actorUid: 'admin-1',
        action: 'support_ticket_status_changed',
        targetId: 'ticket-1',
        afterSummary: expect.objectContaining({
          status: 'resolved',
          resolutionCode: 'payment_under_review',
        }),
      }),
      expect.any(Object),
    );
  });

  it('rejects terminal status without a resolution code', async () => {
    const store = createDb();
    await expect(updateAdminSupportTicket({
      db: store.db,
      request: {
        auth: { uid: 'admin-1' },
        data: {
          ticketId: 'ticket-1',
          status: 'resolved',
          idempotencyKey: 'support-admin-key-0002',
        },
      },
      context: {},
      clock: { now: () => 2_000_000 },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(store.tx.set).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    const store = createDb();
    await expect(updateAdminSupportTicket({
      db: store.db,
      request: {
        auth: { uid: 'passenger-1' },
        data: {
          ticketId: 'ticket-1',
          status: 'in_review',
          idempotencyKey: 'support-admin-key-0003',
        },
      },
      context: {},
      clock: { now: () => 2_000_000 },
    })).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
});