jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
}));

const {
  sendRideQuickMessage,
  idempotencyHash,
  safeRecentOperations,
} = require('../sendQuickMessage');

function createReadOnlyDb(ride) {
  const rideRef = {
    path: 'rideRequests/ride-1',
    id: 'ride-1',
    collection: jest.fn(),
  };
  const tx = {
    get: jest.fn(async () => ({ exists: true, data: () => ride })),
    set: jest.fn(),
  };
  return {
    db: {
      collection: jest.fn(() => ({ doc: () => rideRef })),
      runTransaction: jest.fn(async (handler) => handler(tx)),
    },
    tx,
  };
}

function request(messageCode) {
  return {
    auth: { uid: 'driver-1' },
    data: {
      rideId: 'ride-1',
      messageCode,
      idempotencyKey: 'quick-message-key-0001',
    },
  };
}

describe('quick message idempotency receipts', () => {
  it('keeps only valid bounded receipts', () => {
    const valid = Array.from({ length: 12 }, (_, index) => ({
      keyHash: String(index).padStart(24, 'a').slice(-24),
      messageCode: 'driver_arriving',
      senderRole: 'driver',
      sequence: index + 1,
    }));
    const out = safeRecentOperations([
      null,
      { keyHash: 'not-a-hash' },
      ...valid,
    ]);
    expect(out).toHaveLength(10);
    expect(out[0].sequence).toBe(3);
    expect(out[9].sequence).toBe(12);
  });

  it('replays the exact same action from its original sequence', async () => {
    const keyHash = idempotencyHash('ride-1', 'driver-1', 'quick-message-key-0001');
    const store = createReadOnlyDb({
      status: 'assigned',
      passengerId: 'passenger-1',
      acceptedDriverId: 'driver-1',
      quickMessageSequence: 9,
      quickMessageRecentOperations: [{
        keyHash,
        messageCode: 'driver_arriving',
        senderRole: 'driver',
        sequence: 4,
      }],
    });

    const result = await sendRideQuickMessage({
      db: store.db,
      request: request('driver_arriving'),
      context: {},
      clock: { now: () => 1_000_000 },
    });

    expect(result).toMatchObject({
      messageCode: 'driver_arriving',
      sequence: 4,
      replay: true,
    });
    expect(store.tx.set).not.toHaveBeenCalled();
  });

  it('rejects the same key reused for another message code', async () => {
    const keyHash = idempotencyHash('ride-1', 'driver-1', 'quick-message-key-0001');
    const store = createReadOnlyDb({
      status: 'assigned',
      passengerId: 'passenger-1',
      acceptedDriverId: 'driver-1',
      quickMessageRecentOperations: [{
        keyHash,
        messageCode: 'driver_arriving',
        senderRole: 'driver',
        sequence: 1,
      }],
    });

    await expect(sendRideQuickMessage({
      db: store.db,
      request: request('driver_traffic_delay'),
      context: {},
      clock: { now: () => 1_000_000 },
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(store.tx.set).not.toHaveBeenCalled();
  });
});
