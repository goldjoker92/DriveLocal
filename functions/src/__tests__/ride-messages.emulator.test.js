const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, orderBy, limit } = require('firebase/firestore');
const admin = require('firebase-admin');
const { sendRideMessage } = require('../rides/ride-messages');
const { deleteRideConversation } = require('../accounts/processDeletion');
const PROJECT = 'demo-drivelocal-chat';
const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator('ride messages: real Firestore rules and atomic transactions', () => {
  let env;
  let app;
  let db;
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: PROJECT, firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../../backend/firebase/rules/firestore.rules'), 'utf8'),
    } });
    app = admin.initializeApp({ projectId: PROJECT }, 'ride-chat-emulator');
    db = app.firestore();
  });
  afterAll(async () => { if (env) await env.cleanup(); if (app) await app.delete(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await db.doc('rideRequests/r1').set({ passengerId: 'p1', acceptedDriverId: 'd1', status: 'assigned', exactDestination: 'PRIVATE' });
    await db.doc('rideRequests/r1/conversation/state').set({ driver: true, passenger: true });
    await db.doc('rideRequests/r1/messages/old').set({ kind: 'text', text: 'Stored history', sequence: 0, senderRole: 'passenger' });
  });
  const client = (uid) => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const args = (key = 'message_key_0001') => ({ db, request: { auth: { uid: 'p1' }, data: { rideId: 'r1', text: 'Estou aqui.', idempotencyKey: key } }, clock: { now: () => 100000 }, context: { traceId: 'emulator_trace' } });

  it.each(['d1', 'p1'])('allows %s to read ordered messages and capability state, including after completion', async (uid) => {
    const firestore = client(uid);
    await db.doc('rideRequests/r1').update({ status: 'completed' });
    await assertSucceeds(getDocs(query(collection(firestore, 'rideRequests/r1/messages'), orderBy('sequence', 'desc'), limit(50))));
    await assertSucceeds(getDoc(doc(firestore, 'rideRequests/r1/conversation/state')));
  });
  it.each(['outsider', null])('blocks all conversation reads from %s', async (uid) => {
    await assertFails(getDocs(collection(client(uid), 'rideRequests/r1/messages')));
    await assertFails(getDoc(doc(client(uid), 'rideRequests/r1/conversation/state')));
  });
  it.each(['p1', 'd1', 'outsider'])('blocks direct message and capability writes from %s', async (uid) => {
    await assertFails(setDoc(doc(client(uid), 'rideRequests/r1/messages/forged'), { text: 'forged', senderRole: 'driver' }));
    await assertFails(setDoc(doc(client(uid), 'rideRequests/r1/conversation/state'), { driver: true, passenger: true }));
  });
  it('does not expose the private parent ride to the accepted driver', async () => {
    await assertFails(getDoc(doc(client('d1'), 'rideRequests/r1')));
  });
  it('commits exactly one message and one event for simultaneous retries', async () => {
    const results = await Promise.all([sendRideMessage(args()), sendRideMessage(args())]);
    expect(results.filter((result) => !result.replay)).toHaveLength(1);
    expect(results[0].messageId).toBe(results[1].messageId);
    expect((await db.collection('rideRequests/r1/messages').get()).size).toBe(2);
    expect((await db.collection('notificationEvents').get()).size).toBe(1);
  });
  it('serializes different simultaneous sends through the shared rate limit', async () => {
    const results = await Promise.allSettled([sendRideMessage(args()), sendRideMessage(args('message_key_0002'))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected').reason.safeMetadata.reason).toBe('QUICK_MESSAGE_RATE_LIMIT');
    expect((await db.collection('notificationEvents').get()).size).toBe(1);
  });
  it('purges free text and capability data when a related account is deleted', async () => {
    await sendRideMessage(args());
    await deleteRideConversation(db, 'r1');
    expect((await db.collection('rideRequests/r1/messages').get()).size).toBe(0);
    expect((await db.collection('rideRequests/r1/conversation').get()).size).toBe(0);
    expect((await db.doc('rideRequests/r1').get()).exists).toBe(true);
    await deleteRideConversation(db, 'r1');
  });
});
