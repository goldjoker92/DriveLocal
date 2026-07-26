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

const C = require('../constants');
const { sendRideQuickMessage } = require('../sendQuickMessage');

function createFirestore(initialDocuments) {
  const documents = new Map(Object.entries(initialDocuments));

  function collection(path) {
    return {
      path,
      doc: (id) => document(`${path}/${id}`),
    };
  }

  function document(path) {
    const parts = path.split('/');
    return {
      path,
      id: parts[parts.length - 1],
      collection: (name) => collection(`${path}/${name}`),
    };
  }

  function snapshot(ref) {
    const value = documents.get(ref.path);
    return {
      exists: value !== undefined,
      data: () => value,
      ref,
    };
  }

  const tx = {
    get: jest.fn(async (ref) => snapshot(ref)),
    set: jest.fn((ref, value, options) => {
      const before = documents.get(ref.path) || {};
      documents.set(ref.path, options?.merge ? { ...before, ...value } : { ...value });
    }),
  };

  const db = {
    collection: jest.fn((name) => collection(name)),
    runTransaction: jest.fn(async (handler) => handler(tx)),
  };

  return {
    db,
    tx,
    get: (path) => documents.get(path),
    entries: () => [...documents.entries()],
  };
}

function request({ uid, messageCode, key = 'quick-message-key-0001' }) {
  return {
    auth: { uid },
    data: {
      rideId: 'ride-1',
      messageCode,
      idempotencyKey: key,
    },
  };
}

describe('sendRideQuickMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores a role-only message and queues its notification atomically', async () => {
    const nowMs = 1_000_000;
    const store = createFirestore({
      [`${C.RIDE_REQUESTS}/ride-1`]: {
        status: C.RIDE_STATUS.ASSIGNED,
        passengerId: 'passenger-1',
        acceptedDriverId: 'driver-1',
      },
    });

    const result = await sendRideQuickMessage({
      db: store.db,
      request: request({ uid: 'driver-1', messageCode: 'driver_arriving' }),
      context: { traceId: 'trace-quick-message' },
      clock: { now: () => nowMs },
    });

    expect(result).toEqual({
      rideId: 'ride-1',
      status: C.RIDE_STATUS.ASSIGNED,
      messageCode: 'driver_arriving',
      sequence: 1,
      replay: false,
    });

    const message = store.get(`${C.RIDE_REQUESTS}/ride-1/quickMessages/slot_1`);
    expect(message).toMatchObject({
      rideId: 'ride-1',
      sequence: 1,
      messageCode: 'driver_arriving',
      senderRole: 'driver',
      recipientRole: 'passenger',
      createdAtMs: nowMs,
      expiresAtMs: nowMs + (2 * 60 * 60 * 1000),
    });
    expect(message).not.toHaveProperty('senderUid');
    expect(message).not.toHaveProperty('recipientUid');
    expect(message).not.toHaveProperty('text');
    expect(message).not.toHaveProperty('phone');

    const notificationPath = `${C.NOTIFICATION_EVENTS}/ride-1_ride_quick_message_quick_1_passenger`;
    expect(store.get(notificationPath)).toMatchObject({
      eventType: C.NOTIFICATION_EVENT.RIDE_QUICK_MESSAGE,
      rideId: 'ride-1',
      messageCode: 'driver_arriving',
      recipientUid: 'passenger-1',
      recipientRole: 'passenger',
      route: '/driver-accepted',
      status: C.NOTIFICATION_STATUS.PENDING,
    });
  });

  it('replays the same idempotency key without another message or notification', async () => {
    const nowMs = 1_000_000;
    const store = createFirestore({
      [`${C.RIDE_REQUESTS}/ride-1`]: {
        status: C.RIDE_STATUS.ASSIGNED,
        passengerId: 'passenger-1',
        acceptedDriverId: 'driver-1',
      },
    });
    const args = {
      db: store.db,
      request: request({ uid: 'driver-1', messageCode: 'driver_arriving' }),
      context: { traceId: 'trace-replay' },
      clock: { now: () => nowMs },
    };

    await sendRideQuickMessage(args);
    const firstWriteCount = store.tx.set.mock.calls.length;
    const replay = await sendRideQuickMessage(args);

    expect(replay.replay).toBe(true);
    expect(replay.sequence).toBe(1);
    expect(store.tx.set).toHaveBeenCalledTimes(firstWriteCount);
  });

  it('enforces the server rate limit before creating a second message', async () => {
    let nowMs = 1_000_000;
    const store = createFirestore({
      [`${C.RIDE_REQUESTS}/ride-1`]: {
        status: C.RIDE_STATUS.ASSIGNED,
        passengerId: 'passenger-1',
        acceptedDriverId: 'driver-1',
      },
    });

    await sendRideQuickMessage({
      db: store.db,
      request: request({ uid: 'driver-1', messageCode: 'driver_arriving', key: 'quick-message-key-0001' }),
      context: {},
      clock: { now: () => nowMs },
    });
    nowMs += 4_999;

    await expect(sendRideQuickMessage({
      db: store.db,
      request: request({ uid: 'driver-1', messageCode: 'driver_traffic_delay', key: 'quick-message-key-0002' }),
      context: {},
      clock: { now: () => nowMs },
    })).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      safeMetadata: {
        reason: 'QUICK_MESSAGE_RATE_LIMIT',
        remainingMs: 1,
      },
    });
  });

  it('rejects outsiders, free text, wrong roles and terminal phases', async () => {
    const baseRide = {
      status: C.RIDE_STATUS.ASSIGNED,
      passengerId: 'passenger-1',
      acceptedDriverId: 'driver-1',
    };

    for (const invalid of [
      { uid: 'outsider', messageCode: 'driver_arriving', expected: 'FORBIDDEN' },
      { uid: 'driver-1', messageCode: 'passenger_waiting', expected: 'INVALID_STATE_TRANSITION' },
      { uid: 'passenger-1', messageCode: 'my phone is 999999999', expected: 'INVALID_STATE_TRANSITION' },
    ]) {
      const store = createFirestore({ [`${C.RIDE_REQUESTS}/ride-1`]: baseRide });
      await expect(sendRideQuickMessage({
        db: store.db,
        request: request({ uid: invalid.uid, messageCode: invalid.messageCode }),
        context: {},
        clock: { now: () => 1_000_000 },
      })).rejects.toMatchObject({ code: invalid.expected });
    }

    const terminalStore = createFirestore({
      [`${C.RIDE_REQUESTS}/ride-1`]: { ...baseRide, status: C.RIDE_STATUS.IN_PROGRESS },
    });
    await expect(sendRideQuickMessage({
      db: terminalStore.db,
      request: request({ uid: 'driver-1', messageCode: 'driver_arriving' }),
      context: {},
      clock: { now: () => 1_000_000 },
    })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('reuses six message slots instead of growing history indefinitely', async () => {
    let nowMs = 1_000_000;
    const store = createFirestore({
      [`${C.RIDE_REQUESTS}/ride-1`]: {
        status: C.RIDE_STATUS.ASSIGNED,
        passengerId: 'passenger-1',
        acceptedDriverId: 'driver-1',
      },
    });

    for (let index = 1; index <= 7; index += 1) {
      await sendRideQuickMessage({
        db: store.db,
        request: request({
          uid: 'driver-1',
          messageCode: index % 2 === 0 ? 'driver_traffic_delay' : 'driver_arriving',
          key: `quick-message-key-${String(index).padStart(4, '0')}`,
        }),
        context: {},
        clock: { now: () => nowMs },
      });
      nowMs += 5_000;
    }

    const messageEntries = store.entries().filter(([path]) =>
      path.startsWith(`${C.RIDE_REQUESTS}/ride-1/quickMessages/`)
    );
    expect(messageEntries).toHaveLength(6);
    expect(store.get(`${C.RIDE_REQUESTS}/ride-1/quickMessages/slot_1`)).toMatchObject({ sequence: 7 });
    expect(store.get(`${C.RIDE_REQUESTS}/ride-1`)).toMatchObject({ quickMessageSequence: 7 });
  });
});
