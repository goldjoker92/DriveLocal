const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const { reconcileDriverAvailability, shouldSendAvailabilityAlert, monitorDriverAvailability } = require('../availabilityMonitor');
const { processRideNotificationEvent, buildMulticastMessage } = require('../../notifications/processEvent');
const C = require('../../rides/constants');

const NOW = 1_800_000_000_000;
const SESSION = 'work_driver_1234567890';
function profile(overrides = {}) {
  return {
    verificationStatus: 'approved', availabilityStatus: 'online',
    availabilitySessionId: SESSION, locationAvailabilitySessionId: SESSION,
    availabilitySessionStartedAtMs: NOW - 60 * 60_000,
    availabilityUpdatedAtMs: NOW, locationUpdatedAtMs: NOW - 8 * 60_000,
    location: { lat: -4.1, lng: -38.5 }, pixKey: 'driver@example.test', pixKeyType: 'email',
    commissionFreeUntil: NOW + 86_400_000, ...overrides,
  };
}
async function setup(overrides) {
  const db = makeFakeFirestore();
  await db.collection(C.DRIVERS).doc('driver').set(profile(overrides));
  const run = (options = {}) => reconcileDriverAvailability({
    db, driverId: 'driver', expectedSessionId: SESSION, nowMs: NOW, ...options,
  });
  const driver = () => db._store.get(`${C.DRIVERS}/driver`);
  const events = () => [...db._store.entries()].filter(([key]) => key.startsWith(`${C.NOTIFICATION_EVENTS}/`)).map(([, value]) => value);
  return { db, run, driver, events };
}

describe('availability monitor', () => {
  it('advances its cursor past healthy drivers to inspect the whole fleet', async () => {
    const db = makeFakeFirestore();
    for (let i = 0; i < 101; i += 1) {
      await db.collection(C.DRIVERS).doc(`driver_${String(i).padStart(3, '0')}`).set(profile({
        locationUpdatedAtMs: i === 100 ? NOW - 8 * 60_000 : NOW,
      }));
    }
    const first = await monitorDriverAvailability({ db, nowMs: NOW, context: {} });
    const second = await monitorDriverAvailability({ db, nowMs: NOW, context: {} });
    expect(first).toMatchObject({ scanned: 100, notified: 0 });
    expect(second).toMatchObject({ scanned: 1, interrupted: 1, notified: 1 });
    expect(db._store.get('systemState/driverAvailabilityMonitor').afterId).toBeNull();
  });
  it('records and alerts once without ending a recoverable session', async () => {
    const { run, driver, events } = await setup();
    expect(await run()).toMatchObject({ outcome: 'interrupted', notified: true });
    expect(await run()).toMatchObject({ outcome: 'skipped', notified: false });
    expect(events()).toHaveLength(1);
    expect(driver().availabilitySessionId).toBe(SESSION);
    expect(driver().availabilityHealth.reason).toBe('location_stale');
    expect(events()[0].expiresAtMs).toBe(NOW + 60_000);
  });
  it.each([
    { activeRideId: 'accepted' },
    { availabilitySessionId: 'work_replacement_1234567890' },
    { locationUpdatedAtMs: NOW },
    { availabilityStatus: 'offline' },
  ])('rechecks the live driver instead of trusting the scan: %j', async (changes) => {
    const { db, run, driver, events } = await setup();
    await db.collection(C.DRIVERS).doc('driver').set(changes, { merge: true });
    expect((await run()).outcome).toBe('skipped');
    expect(events()).toHaveLength(0);
    expect(driver()).toMatchObject(changes);
  });
  it('protects a freshly renewed session from abandoned-session cleanup', async () => {
    const { run, driver } = await setup({ locationUpdatedAtMs: NOW });
    expect((await run({ mode: 'abandoned' })).outcome).toBe('skipped');
    expect(driver().availabilityStatus).toBe('online');
  });
  it('closes a truly abandoned session once, without a passenger request', async () => {
    const { run, driver, events } = await setup({ availabilityUpdatedAtMs: NOW - 46 * 60_000 });
    expect((await run()).outcome).toBe('closed');
    expect(driver()).toMatchObject({ availabilityStatus: 'offline', availabilitySessionId: null, availabilityClosedReason: 'work_session_lease_expired' });
    expect((await run()).outcome).toBe('skipped');
    expect(events()).toHaveLength(1);
    expect(shouldSendAvailabilityAlert(driver(), events()[0], NOW)).toBe(true);
  });
  it('suppresses an alert as soon as the GPS recovers, even before the next monitor run', async () => {
    const { db, run, driver, events } = await setup();
    await run();
    await db.collection(C.DRIVERS).doc('driver').set({ locationUpdatedAtMs: NOW }, { merge: true });
    expect(shouldSendAvailabilityAlert(driver(), events()[0], NOW)).toBe(false);
    expect((await run()).outcome).toBe('recovered');
  });
  it('suppresses expired alerts, accepted rides, replaced sessions and manual stops', async () => {
    const { run, driver, events } = await setup();
    await run();
    const event = events()[0];
    expect(shouldSendAvailabilityAlert(driver(), event, NOW + 60_000)).toBe(false);
    expect(shouldSendAvailabilityAlert({ ...driver(), activeRideId: 'ride' }, event, NOW)).toBe(false);
    expect(shouldSendAvailabilityAlert({ ...driver(), availabilitySessionId: 'new' }, event, NOW)).toBe(false);
    expect(shouldSendAvailabilityAlert({ ...driver(), availabilityStatus: 'offline', availabilityHealth: null }, event, NOW)).toBe(false);
  });
  it('does not warn while the first point of a newly opened session is in flight', async () => {
    const { run, events } = await setup({ availabilitySessionStartedAtMs: NOW - 10_000, locationAvailabilitySessionId: null });
    expect((await run()).outcome).toBe('skipped');
    expect(events()).toHaveLength(0);
  });
  it('enforces a cooldown across quick recoveries instead of spamming a weak connection', async () => {
    const { run, db, events } = await setup();
    await run();
    await db.collection(C.DRIVERS).doc('driver').set({ locationUpdatedAtMs: NOW }, { merge: true });
    await run();
    await db.collection(C.DRIVERS).doc('driver').set({ locationUpdatedAtMs: NOW - 8 * 60_000 }, { merge: true });
    expect((await run({ nowMs: NOW + 1000 })).notified).toBe(false);
    expect(events()).toHaveLength(1);
  });
  it('does not call FCM for an obsolete interruption', async () => {
    const { db, run, events } = await setup();
    await run();
    const event = events()[0];
    const messaging = { sendEach: jest.fn() };
    const result = await processRideNotificationEvent({ db, messaging, event,
      eventRef: db.collection(C.NOTIFICATION_EVENTS).doc(event.notificationId),
      context: {}, clock: { now: () => NOW + 61_000 } });
    expect(result.skipped).toBe(true);
    expect(messaging.sendEach).not.toHaveBeenCalled();
  });
  it('uses a short status notification, without private session or location data', async () => {
    const { run, events } = await setup();
    await run();
    const message = buildMulticastMessage(events()[0], ['test-token'], { nowMs: NOW });
    expect(message.android.ttl).toBe(60_000);
    expect(message.android.notification.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_STATUS);
    expect(message.data.route).toBe('/driver-home');
    expect(JSON.stringify(message)).not.toContain(SESSION);
    expect(JSON.stringify(message)).not.toContain('-38.5');
  });
});
