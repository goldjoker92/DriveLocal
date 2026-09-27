jest.mock('firebase-admin', () => ({ firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } }));
jest.mock('../../logging/logger', () => ({ logInfo: jest.fn(), logWarning: jest.fn() }));
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const { sendRideMessage, openRideConversation, messageText } = require('../ride-messages');
const { sendRideQuickMessage } = require('../sendQuickMessage');
const { presentationForEvent, dataPayload } = require('../../notifications/processEvent');
const logger = require('../../logging/logger');

function fixture(status = 'assigned', ready = true) {
  const db = makeFakeFirestore();
  const collection = db.collection;
  db.collection = (path) => {
    const col = collection(path);
    const doc = col.doc;
    col.doc = (id) => {
      const ref = doc(id);
      ref.collection = (name) => db.collection(`${path}/${ref.id}/${name}`);
      return ref;
    };
    return col;
  };
  db._store.set('rideRequests/ride1', { passengerId: 'p1', acceptedDriverId: 'd1', status });
  if (ready) db._store.set('rideRequests/ride1/conversation/state', { passenger: true, driver: true });
  let time = 100000;
  const call = (overrides = {}) => ({ db, clock: { now: () => time }, context: { traceId: 'trace1' },
    request: { auth: { uid: 'p1' }, data: { rideId: 'ride1', text: 'Estou ao lado da farmácia.', idempotencyKey: 'message_key_000001' } }, ...overrides });
  return { db, call, tick: (ms = 5000) => { time += ms; } };
}
const messages = (db) => [...db._store.entries()].filter(([key]) => key.startsWith('rideRequests/ride1/messages/'));
const events = (db) => [...db._store.entries()].filter(([key]) => key.startsWith('notificationEvents/'));

beforeEach(() => jest.clearAllMocks());

describe('ride conversation authorization and compatibility', () => {
  it.each(['p1', 'd1'])('opens safe context for %s and registers only its capability', async (uid) => {
    const { db, call } = fixture('assigned', false);
    const result = await openRideConversation(call({ request: { auth: { uid }, data: { rideId: 'ride1' } } }));
    const role = uid === 'p1' ? 'passenger' : 'driver';
    expect(result).toEqual({ rideId: 'ride1', role, status: 'assigned', traceId: 'trace1' });
    expect(db._store.get('rideRequests/ride1/conversation/state')).toEqual({ [role]: true });
    expect(db._store.get('rideRequests/ride1').status).toBe('assigned');
  });
  it.each([null, 'outsider'])('denies context and send for %s', async (uid) => {
    const { db, call } = fixture();
    const request = { ...call().request, auth: uid ? { uid } : null };
    await expect(sendRideMessage(call({ request }))).rejects.toMatchObject({ code: uid ? 'FORBIDDEN' : 'UNAUTHENTICATED' });
    await expect(openRideConversation(call({ request: { ...request, data: { rideId: 'ride1' } } }))).rejects.toMatchObject({ code: uid ? 'FORBIDDEN' : 'UNAUTHENTICATED' });
    expect(messages(db)).toHaveLength(0);
  });
  it('blocks invisible free text to a legacy peer but preserves the old presets', async () => {
    const { db, call } = fixture('assigned', false);
    await expect(sendRideMessage(call())).rejects.toMatchObject({ safeMetadata: { reason: 'MESSAGE_PEER_NOT_READY' } });
    await sendRideQuickMessage(call({ request: { auth: { uid: 'p1' }, data: { rideId: 'ride1', messageCode: 'passenger_waiting', idempotencyKey: 'preset_key_000001' } } }));
    expect(messages(db)).toHaveLength(1);
    expect(messages(db)[0][1]).toMatchObject({ kind: 'preset', messageCode: 'passenger_waiting' });
    expect(db._store.has('rideRequests/ride1/quickMessages/slot_1')).toBe(true);
  });
  it('blocks new catalog codes until both clients support them', async () => {
    const { call } = fixture('assigned', false);
    await expect(sendRideQuickMessage(call({ request: { auth: { uid: 'd1' }, data: { rideId: 'ride1', messageCode: 'driver_where_waiting', idempotencyKey: 'preset_key_000001' } } })))
      .rejects.toMatchObject({ safeMetadata: { reason: 'MESSAGE_PEER_NOT_READY' } });
  });
  it.each(['searching', 'in_progress', 'awaiting_payment', 'payment_marked_sent', 'completed', 'cancelled', 'disputed'])('closes new sends in %s', async (status) => {
    const { db, call } = fixture(status);
    await expect(sendRideMessage(call())).rejects.toMatchObject({ safeMetadata: { reason: 'MESSAGE_CLOSED' } });
    expect(messages(db)).toHaveLength(0);
    expect(events(db)).toHaveLength(0);
  });
  it.each(['passenger', 'driver'])('saves immutable text from %s without changing ride lifecycle', async (role) => {
    const { db, call } = fixture('driver_arrived');
    const request = { ...call().request, auth: { uid: role === 'driver' ? 'd1' : 'p1' } };
    const result = await sendRideMessage(call({ request }));
    expect(messages(db)[0][1]).toMatchObject({ kind: 'text', senderRole: role, createdAt: 'SERVER_TIME', sequence: 1, traceId: 'trace1' });
    expect(events(db)).toHaveLength(1);
    expect(db._store.get('rideRequests/ride1').status).toBe('driver_arrived');
    expect(result).not.toHaveProperty('text');
  });
});

describe('retries, rate limits and privacy', () => {
  it('replays after a lost response and even after the ride closes', async () => {
    const { db, call } = fixture();
    const first = await sendRideMessage(call());
    db._store.get('rideRequests/ride1').status = 'completed';
    const retry = await sendRideMessage(call());
    expect(retry).toMatchObject({ messageId: first.messageId, sequence: 1, replay: true });
    expect(messages(db)).toHaveLength(1);
    expect(events(db)).toHaveLength(1);
  });
  it('rejects a key reused with different text', async () => {
    const { call } = fixture();
    await sendRideMessage(call());
    const request = call().request;
    request.data.text = 'Outro texto';
    await expect(sendRideMessage(call({ request }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('shares the same 5s cooldown with legacy presets', async () => {
    const { call, tick } = fixture();
    await sendRideMessage(call());
    tick(4999);
    const request = { auth: { uid: 'p1' }, data: { rideId: 'ride1', messageCode: 'passenger_waiting', idempotencyKey: 'preset_key_000001' } };
    await expect(sendRideQuickMessage(call({ request }))).rejects.toMatchObject({ safeMetadata: { remainingMs: 1 } });
    tick(1);
    await expect(sendRideQuickMessage(call({ request }))).resolves.toMatchObject({ sequence: 2 });
    const next = call().request; next.data.idempotencyKey = 'message_key_000002';
    await expect(sendRideMessage(call({ request: next }))).rejects.toMatchObject({ safeMetadata: { remainingMs: 5000 } });
  });
  it('keeps preset idempotency beyond the ten legacy receipts', async () => {
    const { db, call, tick } = fixture();
    const request = (n) => ({ auth: { uid: 'p1' }, data: { rideId: 'ride1', messageCode: 'passenger_waiting', idempotencyKey: `preset_key_${String(n).padStart(6, '0')}` } });
    for (let n = 0; n < 12; n += 1) { await sendRideQuickMessage(call({ request: request(n) })); tick(); }
    expect(await sendRideQuickMessage(call({ request: request(0) }))).toMatchObject({ replay: true, sequence: 1 });
    expect(messages(db)).toHaveLength(12);
    expect(events(db)).toHaveLength(12);
  });
  it('never puts the text in logs, notification events or FCM payloads', async () => {
    const { db, call } = fixture();
    const secret = 'Meu telefone 85999999999, portão 42';
    const request = call().request; request.data.text = secret;
    await sendRideMessage(call({ request }));
    const event = events(db)[0][1];
    expect(presentationForEvent(event)).toEqual({ title: 'Nova mensagem na corrida', body: 'Abra o DriveLocal para ver a mensagem.' });
    expect(JSON.stringify([event, dataPayload(event), logger.logInfo.mock.calls, logger.logWarning.mock.calls])).not.toContain(secret);
  });
  it('rejects spoofed author, timestamp, phase and price fields', async () => {
    const { call } = fixture();
    for (const field of ['senderRole', 'createdAtMs', 'status', 'price']) {
      const request = call().request; request.data[field] = 'spoofed';
      await expect(sendRideMessage(call({ request }))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });
});

describe('short text validation', () => {
  it.each(['', ' \n ', '\u200B', '\u200D\uFE0F', 'a'.repeat(281), null, {}])('rejects empty, invisible or oversized input %#', (value) => {
    expect(() => messageText(value)).toThrow();
  });
  it('preserves accents and emoji, normalizes controls and accepts exactly 280 code points', () => {
    expect(messageText('  Oi\r\nCafe\u0301 \u202E🙂 ')).toBe('Oi\nCafé 🙂');
    expect([...messageText('🙂'.repeat(280))]).toHaveLength(280);
  });
});
