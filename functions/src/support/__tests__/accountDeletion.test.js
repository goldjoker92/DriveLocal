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

const { pseudonymizeSupportTickets } = require('../accountDeletion');

function createDb(tickets) {
  const documents = new Map(Object.entries(tickets));
  const refs = new Map();

  function ref(id) {
    if (!refs.has(id)) refs.set(id, { id, path: `supportTickets/${id}` });
    return refs.get(id);
  }

  const db = {
    collection: jest.fn(() => ({
      where: jest.fn((field, operator, value) => ({
        limit: jest.fn(() => ({
          get: jest.fn(async () => {
            expect(field).toBe('actorUid');
            expect(operator).toBe('==');
            const docs = [...documents.entries()]
              .filter(([, ticket]) => ticket.actorUid === value)
              .map(([id, ticket]) => ({ id, ref: ref(id), data: () => ticket }));
            return { docs, empty: docs.length === 0, size: docs.length };
          }),
        })),
      })),
    })),
    batch: jest.fn(() => {
      const updates = [];
      return {
        set(documentRef, value, options) {
          updates.push({ documentRef, value, options });
        },
        async commit() {
          for (const update of updates) {
            const before = documents.get(update.documentRef.id) || {};
            documents.set(update.documentRef.id, update.options?.merge
              ? { ...before, ...update.value }
              : { ...update.value });
          }
        },
      };
    }),
  };

  return { db, documents };
}

describe('support ticket account deletion cleanup', () => {
  it('replaces the Firebase uid and removes the issue fingerprint', async () => {
    const store = createDb({
      'ticket-1': {
        actorUid: 'user-1',
        actorHash: 'old-hash',
        actorRole: 'passenger',
        issueFingerprint: 'old-fingerprint',
        status: 'open',
      },
      'ticket-other': {
        actorUid: 'other-user',
        actorHash: 'other-hash',
        status: 'open',
      },
    });

    const result = await pseudonymizeSupportTickets({
      db: store.db,
      requestData: {
        subjectUid: 'user-1',
        anonymousSubjectId: 'anon-123',
        role: 'passenger',
      },
      context: {},
    });

    expect(result).toEqual({ status: 'completed', count: 1 });
    expect(store.documents.get('ticket-1')).toMatchObject({
      actorUid: 'anon-123',
      actorHash: 'hash_anon-1',
      issueFingerprint: 'DELETE_FIELD',
      accountDeleted: true,
      accountDeletedAt: 'SERVER_TIMESTAMP',
    });
    expect(store.documents.get('ticket-other').actorUid).toBe('other-user');
  });

  it('skips an invalid deletion request without querying tickets', async () => {
    const store = createDb({});
    const result = await pseudonymizeSupportTickets({
      db: store.db,
      requestData: { subjectUid: 'user-1' },
      context: {},
    });
    expect(result).toEqual({ status: 'skipped', count: 0 });
    expect(store.db.collection).not.toHaveBeenCalled();
  });
});