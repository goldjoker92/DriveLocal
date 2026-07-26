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
  shortHash: (value) => `hash_${String(value).slice(0, 6)}`,
}));

jest.mock('../../audit/auditLog', () => ({ writeAuditLog: jest.fn() }));

const { createSupportTicket } = require('../tickets');

function createDb(initial = {}) {
  const documents = new Map(Object.entries(initial));

  function documentRef(collectionName, id) {
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

  function querySnapshot(collectionName, clauses, max) {
    const prefix = `${collectionName}/`;
    const docs = [...documents.entries()]
      .filter(([path, value]) => {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) return false;
        return clauses.every((clause) => {
          if (clause.operator === '==') return value?.[clause.field] === clause.expected;
          if (clause.operator === 'in') return clause.expected.includes(value?.[clause.field]);
          return false;
        });
      })
      .slice(0, max)
      .map(([path, value]) => {
        const id = path.slice(prefix.length);
        return { id, ref: documentRef(collectionName, id), data: () => value };
      });
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  function queryBuilder(collectionName, clauses = [], max = Infinity) {
    return {
      where(field, operator, expected) {
        return queryBuilder(collectionName, [...clauses, { field, operator, expected }], max);
      },
      limit(nextMax) {
        return queryBuilder(collectionName, clauses, nextMax);
      },
      async get() {
        return querySnapshot(collectionName, clauses, max);
      },
    };
  }

  const tx = {
    async get(ref) {
      return ref.get();
    },
    create(ref, value) {
      documents.set(ref.path, { ...value });
    },
  };

  const db = {
    collection(collectionName) {
      return {
        doc(id) {
          return documentRef(collectionName, id);
        },
        where(field, operator, expected) {
          return queryBuilder(collectionName).where(field, operator, expected);
        },
      };
    },
    async runTransaction(handler) {
      return handler(tx);
    },
  };

  return { db, documents };
}

describe('createSupportTicket', () => {
  it('creates, replays the same key, and deduplicates the same active issue', async () => {
    const store = createDb({
      'drivers/driver-1': { uid: 'driver-1', accountDeletionStatus: null },
    });
    const args = {
      db: store.db,
      request: {
        auth: { uid: 'driver-1' },
        data: {
          categoryCode: 'technical_error',
          sourceRoute: 'driver_home',
          idempotencyKey: 'support-key-0001',
        },
      },
      context: { traceId: 'trace-support' },
      clock: { now: () => 1_000_000 },
    };

    const first = await createSupportTicket(args);
    expect(first).toMatchObject({
      actorRole: 'driver',
      categoryCode: 'technical_error',
      status: 'open',
      rideId: null,
      replay: false,
    });

    const record = store.documents.get(`supportTickets/${first.ticketId}`);
    expect(record).toMatchObject({
      actorUid: 'driver-1',
      actorHash: 'hash_driver',
      actorRole: 'driver',
      categoryCode: 'technical_error',
      status: 'open',
      sourceRoute: 'driver_home',
      contextSnapshot: { ride: null, payment: null },
    });
    expect(record).not.toHaveProperty('message');
    expect(record).not.toHaveProperty('text');

    // Same idempotency key replays the exact operation; it is not a new duplicate issue.
    const replay = await createSupportTicket(args);
    expect(replay).toMatchObject({
      ticketId: first.ticketId,
      replay: true,
    });
    expect(replay).not.toHaveProperty('duplicate');

    // A different key for the same still-active issue reuses the ticket as a business duplicate.
    const duplicate = await createSupportTicket({
      ...args,
      request: {
        ...args.request,
        data: {
          ...args.request.data,
          idempotencyKey: 'support-key-0002',
        },
      },
    });
    expect(duplicate).toMatchObject({
      ticketId: first.ticketId,
      replay: true,
      duplicate: true,
    });
    expect([...store.documents.keys()].filter((key) => key.startsWith('supportTickets/'))).toHaveLength(1);
  });

  it('requires a ride id for a ride category', async () => {
    const store = createDb({
      'passengers/passenger-1': { uid: 'passenger-1' },
    });
    await expect(createSupportTicket({
      db: store.db,
      request: {
        auth: { uid: 'passenger-1' },
        data: {
          categoryCode: 'ride_status_issue',
          sourceRoute: 'passenger_home',
          idempotencyKey: 'support-key-0002',
        },
      },
      context: {},
      clock: { now: () => 1_000_000 },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
