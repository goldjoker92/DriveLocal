const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, Timestamp, serverTimestamp } = require('firebase/firestore');

// CI always supplies the emulator host; ordinary unit runs explicitly skip.
const describeRules = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
describeRules('driver availability rules', () => {
  let env;
  const SESSION = 'work_driver_1234567890';
  const uid = 'driver';
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-drivelocal-availability', firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../../backend/firebase/rules/firestore.rules'), 'utf8'),
    } });
  });
  afterAll(async () => { if (env) await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });
  async function seed(overrides = {}) {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'drivers', uid), {
      uid, verificationStatus: 'approved', availabilityStatus: 'online', availabilitySessionId: SESSION,
      availabilityUpdatedAt: Timestamp.fromMillis(Date.now() - 40 * 60_000),
      availabilityUpdatedAtMs: Date.now() - 40 * 60_000,
      location: { lat: -4.1, lng: -38.5 }, locationAvailabilitySessionId: SESSION,
      locationUpdatedAt: Timestamp.fromMillis(Date.now() - 40 * 60_000),
      locationUpdatedAtMs: Date.now() - 40 * 60_000,
      locationAccuracyMeters: 10, locationSpeedMps: 0, locationHeadingDegrees: 0,
      ...overrides,
    }));
  }
  const ref = (actor = uid) => doc(env.authenticatedContext(actor).firestore(), 'drivers', uid);
  const heartbeat = (session = SESSION) => ({
    availabilityUpdatedAtMs: Date.now(), availabilityUpdatedAt: serverTimestamp(),
    availabilityClientBuildNumber: 22, availabilityClientVersion: '1.0.17',
    availabilityClientSessionId: session, availabilityClientUpdatedAtMs: Date.now(),
    availabilityClientUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  it('allows a bound heartbeat in the recovery window without refreshing or rebinding GPS', async () => {
    await seed({ locationAvailabilitySessionId: null });
    const before = (await getDoc(ref())).data();
    await assertSucceeds(updateDoc(ref(), heartbeat()));
    const after = (await getDoc(ref())).data();
    expect(after.locationUpdatedAt.toMillis()).toBe(before.locationUpdatedAt.toMillis());
    expect(after.locationAvailabilitySessionId).toBeNull();
  });
  it('allows a new GPS point to restore the same session after 40 minutes', async () => {
    await seed();
    await assertSucceeds(updateDoc(ref(), { ...heartbeat(),
      location: { lat: -4.11, lng: -38.51 }, locationUpdatedAt: serverTimestamp(),
      locationUpdatedAtMs: Date.now(), locationAvailabilitySessionId: SESSION,
    }));
  });
  it.each([
    { availabilityStatus: 'offline' },
    { availabilitySessionId: 'work_replaced_1234567890' },
    { availabilityUpdatedAt: Timestamp.fromMillis(Date.now() - 46 * 60_000) },
  ])('rejects renewing an ended, replaced or abandoned session: %j', async (overrides) => {
    await seed(overrides);
    await assertFails(updateDoc(ref(), heartbeat()));
  });
  it('rejects a heartbeat that binds an old point to a new session', async () => {
    await seed({ locationAvailabilitySessionId: null });
    await assertFails(updateDoc(ref(), { ...heartbeat(), locationAvailabilitySessionId: SESSION }));
  });
  it('rejects GPS updates using a stale session even when heartbeat uses the current one', async () => {
    await seed();
    await assertFails(updateDoc(ref(), { ...heartbeat(), locationAvailabilitySessionId: 'work_old_session_123456789',
      locationUpdatedAt: serverTimestamp(), locationUpdatedAtMs: Date.now() }));
  });
  it('rejects updates by another driver and client writes to monitor health or online status', async () => {
    await seed();
    await assertFails(updateDoc(ref('intruder'), heartbeat()));
    await assertFails(updateDoc(ref(), { ...heartbeat(), availabilityHealth: { state: 'ready' } }));
    await assertFails(updateDoc(ref(), { ...heartbeat(), availabilityStatus: 'offline' }));
  });
});
