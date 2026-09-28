const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const guard = require('../liveLocationGuard');
const { processRideNotificationEvent, buildMulticastMessage } = require('../../notifications/processEvent');
const C = require('../constants');

const NOW = Date.parse('2026-09-27T22:05:00.000Z');
const RIDE = 'ride_live_guard_0001';
const DRIVER = 'driver_live_guard';
const PASSENGER = 'passenger_live_guard';
const SESSION = 'work_live_guard_000001';
const PICKUP_POINT = { lat: -4.1012345, lng: -38.4912345 };
const STALE_POINT = { lat: -4.0995358, lng: -38.5006227 };
const FRESH_POINT = { lat: -4.0987654, lng: -38.4987654 };
const ts = (ms) => admin.firestore.Timestamp.fromMillis(ms);

// The rules are the authority on the ride point shape. Read them instead of
// copying the list, so a future rules change breaks this test, not production.
function rulesLiveLocationKeys() {
  const rules = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'backend', 'firebase', 'rules', 'firestore.rules'),
    'utf8'
  );
  const block = rules.match(/function liveLocationKeys\(\)\s*{\s*return\s*\[([\s\S]*?)\];/);
  return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort();
}

function rideDoc(overrides = {}) {
  return {
    rideId: RIDE,
    passengerId: PASSENGER,
    status: C.RIDE_STATUS.ASSIGNED,
    vehicleType: 'car',
    acceptedDriverId: DRIVER,
    acceptedAvailabilitySessionId: SESSION,
    acceptedAtMs: NOW - 9 * 60_000,
    pickup: { ...PICKUP_POINT, label: 'Embarque' },
    ...overrides,
  };
}

function driverDoc(pointMs, overrides = {}) {
  return {
    verificationStatus: 'approved',
    availabilityStatus: 'online',
    availabilitySessionId: SESSION,
    activeRideId: RIDE,
    vehicleType: 'car',
    location: FRESH_POINT,
    locationAvailabilitySessionId: SESSION,
    locationAccuracyMeters: 8,
    locationHeadingDegrees: 120,
    locationSpeedMps: 6.4,
    locationUpdatedAtMs: pointMs,
    locationUpdatedAt: ts(pointMs),
    availabilityClientBuildNumber: 18,
    ...overrides,
  };
}

function trackingDoc(pointMs, overrides = {}) {
  return {
    rideId: RIDE,
    driverId: DRIVER,
    vehicleType: 'car',
    location: STALE_POINT,
    accuracyMeters: 12,
    headingDegrees: null,
    speedMps: null,
    updatedAtMs: pointMs,
    updatedAt: ts(pointMs),
    ...overrides,
  };
}

async function setup({ ride = {}, driver, tracking } = {}) {
  const db = makeFakeFirestore();
  await db.collection(C.RIDE_REQUESTS).doc(RIDE).set(rideDoc(ride));
  if (driver !== null) await db.collection(C.DRIVERS).doc(DRIVER).set(driver || driverDoc(NOW - 5_000));
  if (tracking !== null) {
    await db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(RIDE).set(tracking || trackingDoc(NOW - 9 * 60_000));
  }
  const get = (collection, id = RIDE) => db._store.get(`${collection}/${id}`);
  const events = () => [...db._store.entries()]
    .filter(([key]) => key.startsWith(`${C.NOTIFICATION_EVENTS}/`))
    .map(([, value]) => value);
  const reconcile = (nowMs = NOW) => guard.reconcileRideLiveLocation({ db, rideId: RIDE, nowMs, context: {} });
  return { db, get, events, reconcile };
}

describe('live-location guard: mirror', () => {
  it('moves a frozen passenger map with the driver point, keeping its true server time', async () => {
    const { db, get } = await setup({ driver: driverDoc(NOW - 4_000) });
    const result = await guard.mirrorDriverPointToRide({ db, driverId: DRIVER, rideId: RIDE, nowMs: NOW, context: {} });

    expect(result).toMatchObject({ outcome: 'mirrored', reason: 'driver_point_newer' });
    const point = get(C.ACTIVE_RIDE_LOCATIONS);
    expect(point.location).toEqual(FRESH_POINT);
    expect(point.updatedAtMs).toBe(NOW - 4_000);
    expect(point.updatedAt.toMillis()).toBe(NOW - 4_000);
    expect(point.speedMps).toBe(6.4);
    expect(get(C.RIDE_TRACKING_HEALTH)).toMatchObject({ mirroredPoints: 1, lastMirrorSource: 'driver_point' });
  });

  it('writes exactly the rules liveLocationKeys, so later client writes are never rejected', async () => {
    const { db, get } = await setup({ driver: driverDoc(NOW - 4_000) });
    await guard.mirrorDriverPointToRide({ db, driverId: DRIVER, rideId: RIDE, nowMs: NOW, context: {} });
    expect(Object.keys(get(C.ACTIVE_RIDE_LOCATIONS)).sort()).toEqual(rulesLiveLocationKeys());
  });

  it('keeps the moto vehicle type and creates the point when acceptance had none', async () => {
    const { db, get } = await setup({
      ride: { vehicleType: 'moto' },
      driver: driverDoc(NOW - 2_000, { vehicleType: 'moto' }),
      tracking: null,
    });
    const result = await guard.mirrorDriverPointToRide({ db, driverId: DRIVER, rideId: RIDE, nowMs: NOW, context: {} });
    expect(result.reason).toBe('ride_point_missing');
    expect(get(C.ACTIVE_RIDE_LOCATIONS)).toMatchObject({ vehicleType: 'moto', driverId: DRIVER });
  });

  it.each([
    ['another work session', { driver: driverDoc(NOW - 1_000, { locationAvailabilitySessionId: 'work_other_session_0001' }) }, 'session_mismatch'],
    ['a driver no longer on this ride', { driver: driverDoc(NOW - 1_000, { activeRideId: null }) }, 'driver_not_on_ride'],
    ['a ride that is not assigned to him', { ride: { acceptedDriverId: 'someone_else' } }, 'not_accepted_driver'],
    ['a ride waiting for payment', { ride: { status: C.RIDE_STATUS.AWAITING_PAYMENT } }, 'ride_not_active'],
    ['a cancelled ride', { ride: { status: C.RIDE_STATUS.CANCELLED }, tracking: null }, 'ride_not_active'],
  ])('never draws a point from %s', async (_label, options, reason) => {
    const { db, get } = await setup(options);
    const before = get(C.ACTIVE_RIDE_LOCATIONS);
    const result = await guard.mirrorDriverPointToRide({ db, driverId: DRIVER, rideId: RIDE, nowMs: NOW, context: {} });
    expect(result).toEqual({ outcome: 'skipped', reason });
    expect(get(C.ACTIVE_RIDE_LOCATIONS)).toEqual(before);
    expect(get(C.RIDE_TRACKING_HEALTH)).toBeUndefined();
  });

  it('ignores the same fix a healthy client writes on its profile a moment later', async () => {
    const pointMs = NOW - 3_000;
    const { db } = await setup({
      tracking: trackingDoc(pointMs, { location: FRESH_POINT }),
      driver: driverDoc(pointMs + 2_500),
    });
    const result = await guard.mirrorDriverPointToRide({ db, driverId: DRIVER, rideId: RIDE, nowMs: NOW, context: {} });
    expect(result).toEqual({ outcome: 'skipped', reason: 'ride_point_current' });
  });

  it('never replaces a newer ride point with an older profile point', async () => {
    const { db } = await setup({ tracking: trackingDoc(NOW - 1_000), driver: driverDoc(NOW - 20_000) });
    const result = await guard.mirrorDriverPointToRide({ db, driverId: DRIVER, rideId: RIDE, nowMs: NOW, context: {} });
    expect(result.reason).toBe('ride_point_current');
  });

  it('lets the trigger exit on one read when the ride point already has the fix', () => {
    const tracking = trackingDoc(NOW, { location: FRESH_POINT });
    expect(guard.ridePointIsCurrent(tracking, FRESH_POINT, NOW + 900)).toBe(true);
    expect(guard.ridePointIsCurrent(tracking, FRESH_POINT, NOW + 10_000)).toBe(true);
    expect(guard.ridePointIsCurrent(tracking, STALE_POINT, NOW + 10_000)).toBe(false);
    expect(guard.ridePointIsCurrent(null, FRESH_POINT, NOW)).toBe(false);
  });

  it('only reacts to a driver on a ride whose point advanced', () => {
    const before = { activeRideId: RIDE, locationUpdatedAt: ts(NOW - 10_000) };
    expect(guard.driverPointAdvanced(before, { ...before, locationUpdatedAt: ts(NOW) })).toBe(true);
    expect(guard.driverPointAdvanced(before, { ...before })).toBe(false);
    expect(guard.driverPointAdvanced(before, { activeRideId: null, locationUpdatedAt: ts(NOW) })).toBe(false);
  });
});

describe('live-location guard: monitor', () => {
  it('turns a frozen approach into one incident, one driver alert and one passenger notice', async () => {
    // The field case: driver silent everywhere, passenger staring at a frozen car.
    const { get, events, reconcile } = await setup({ driver: driverDoc(NOW - 9 * 60_000) });
    const result = await reconcile();

    expect(result).toMatchObject({ outcome: 'stale', driverAlert: true, passengerNotice: true, mirrored: false });
    expect(get(C.RIDE_TRACKING_HEALTH)).toMatchObject({
      state: 'stale', incidentNumber: 1, incidentRideStatus: 'assigned', driverAlertCount: 1, driverBuildNumber: 18,
      passengerNoticeAtMs: NOW, staleChecks: 1,
    });
    const [driverEvent, passengerEvent] = [
      events().find((e) => e.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE),
      events().find((e) => e.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_DELAYED),
    ];
    expect(driverEvent).toMatchObject({ recipientUid: DRIVER, recipientRole: 'driver', route: '/active-ride', incidentNumber: 1 });
    expect(passengerEvent).toMatchObject({ recipientUid: PASSENGER, recipientRole: 'passenger', route: '/driver-accepted' });
    expect(JSON.stringify(events())).not.toContain('-38.');
  });

  it('bounds driver alerts: cooldown, then a second one, never a third', async () => {
    const { events, reconcile } = await setup({ driver: driverDoc(NOW - 9 * 60_000) });
    const driverAlerts = () => events().filter((e) => e.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE).length;
    const passengerNotices = () => events().filter((e) => e.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_DELAYED).length;

    await reconcile(NOW);
    await reconcile(NOW + 60_000);
    expect([driverAlerts(), passengerNotices()]).toEqual([1, 1]);
    await reconcile(NOW + guard.DRIVER_ALERT_COOLDOWN_MS);
    expect(driverAlerts()).toBe(2);
    await reconcile(NOW + 3 * guard.DRIVER_ALERT_COOLDOWN_MS);
    expect([driverAlerts(), passengerNotices()]).toEqual([guard.MAX_DRIVER_ALERTS_PER_RIDE, 1]);
  });

  it('relays the fallback profile point and still tells the driver his ride channel is down', async () => {
    const { get, events, reconcile } = await setup({ driver: driverDoc(NOW - 30_000) });
    const result = await reconcile();

    expect(result).toMatchObject({ outcome: 'relayed', mirrored: true, driverAlert: true, passengerNotice: false });
    expect(get(C.ACTIVE_RIDE_LOCATIONS).location).toEqual(FRESH_POINT);
    expect(get(C.RIDE_TRACKING_HEALTH)).toMatchObject({ state: 'relayed', mirroredPoints: 1, lastMirrorSource: 'monitor' });
    expect(events().map((e) => e.eventType)).toEqual([C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE]);
  });

  it.each([C.RIDE_STATUS.DRIVER_ARRIVED, C.RIDE_STATUS.IN_PROGRESS])(
    'records a %s incident without notifying anyone',
    async (status) => {
      const { get, events, reconcile } = await setup({ ride: { status }, driver: driverDoc(NOW - 9 * 60_000) });
      const result = await reconcile();
      expect(result).toMatchObject({ outcome: 'stale', driverAlert: false, passengerNotice: false });
      expect(get(C.RIDE_TRACKING_HEALTH)).toMatchObject({ state: 'stale', incidentRideStatus: status });
      expect(events()).toHaveLength(0);
    }
  );

  it('closes the incident as soon as the ride point is fresh again', async () => {
    const { db, get, reconcile } = await setup({ driver: driverDoc(NOW - 9 * 60_000) });
    await reconcile(NOW);
    await db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(RIDE).set(trackingDoc(NOW + 55_000, { location: FRESH_POINT }));
    const result = await reconcile(NOW + 60_000);
    expect(result.outcome).toBe('recovered');
    expect(get(C.RIDE_TRACKING_HEALTH)).toMatchObject({
      state: 'healthy', recoveredAtMs: NOW + 60_000, lastIncidentDurationMs: 60_000, incidentNumber: 1,
    });
  });

  it('writes a healthy ride once, then leaves it alone', async () => {
    const { get, reconcile } = await setup({
      tracking: trackingDoc(NOW - 5_000, { location: FRESH_POINT }),
      driver: driverDoc(NOW - 5_000),
    });
    await reconcile(NOW);
    const first = { ...get(C.RIDE_TRACKING_HEALTH) };
    await reconcile(NOW + 10_000);
    expect(first).toMatchObject({ state: 'healthy', firstCheckedAtMs: NOW });
    expect(get(C.RIDE_TRACKING_HEALTH)).toEqual(first);
  });

  it('ignores a ride left open for hours instead of alerting on it every minute', async () => {
    const { get, events, reconcile } = await setup({
      ride: { acceptedAtMs: NOW - 4 * 60 * 60_000 },
      tracking: trackingDoc(NOW - 4 * 60 * 60_000),
      driver: driverDoc(NOW - 4 * 60 * 60_000),
    });
    expect((await reconcile()).outcome).toBe('abandoned');
    expect(get(C.RIDE_TRACKING_HEALTH)).toBeUndefined();
    expect(events()).toHaveLength(0);
  });

  it('never resurrects the point of a ride that already ended', async () => {
    const { get, reconcile } = await setup({ ride: { status: C.RIDE_STATUS.CANCELLED }, tracking: null });
    expect((await reconcile()).outcome).toBe('skipped');
    expect(get(C.ACTIVE_RIDE_LOCATIONS)).toBeUndefined();
    expect(get(C.RIDE_TRACKING_HEALTH)).toBeUndefined();
  });

  it('scans the three moving statuses only', async () => {
    const db = makeFakeFirestore();
    const statuses = ['searching', 'assigned', 'driver_arrived', 'in_progress', 'awaiting_payment', 'cancelled'];
    for (const status of statuses) {
      const rideId = `ride_${status}`;
      await db.collection(C.RIDE_REQUESTS).doc(rideId).set(rideDoc({ rideId, status, acceptedDriverId: `driver_${status}` }));
    }
    const summary = await guard.monitorRideLiveLocation({ db, nowMs: NOW, context: {} });
    expect(summary.scanned).toBe(3);
    expect(summary.failed).toBe(0);
  });

  it('logs committed incidents with hashes only, never coordinates or raw ids', async () => {
    const logger = require('firebase-functions/logger');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const { reconcile } = await setup({ driver: driverDoc(NOW - 9 * 60_000) });
      await reconcile();
      const [eventName, fields] = warn.mock.calls[0];
      expect(eventName).toBe('ride.live_point.stale');
      expect(fields).toMatchObject({ rideId: RIDE, rideStatus: 'assigned', driverAlert: true });
      expect(fields.driverIdHash).toMatch(/^[a-f0-9]{12}$/);
      const text = JSON.stringify(fields);
      expect(text).not.toContain(DRIVER);
      expect(text).not.toContain(PASSENGER);
      expect(text).not.toContain('-38.');
    } finally { warn.mockRestore(); }
  });
});

describe('live-location guard: delivery', () => {
  async function staleWithToken(uid) {
    const context = await setup({ driver: driverDoc(NOW - 9 * 60_000) });
    await context.db.collection(C.NOTIFICATION_TOKENS).doc(`token_${uid}`)
      .set({ uid, active: true, platform: 'android', token: `fcm_${uid}` });
    await context.reconcile(NOW);
    return context;
  }
  const messaging = () => ({
    sendEach: jest.fn(async (messages) => ({ responses: messages.map(() => ({ success: true })) })),
  });
  const run = (db, event, nowMs, m) => processRideNotificationEvent({
    db, messaging: m, event, context: {}, clock: { now: () => nowMs },
    eventRef: db.collection(C.NOTIFICATION_EVENTS).doc(event.notificationId),
  });

  it('delivers a still-valid driver alert on the status channel, one slot per ride', async () => {
    const { db, events } = await staleWithToken(DRIVER);
    const event = events().find((e) => e.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE);
    const m = messaging();
    await run(db, event, NOW + 2_000, m);
    expect(m.sendEach).toHaveBeenCalledTimes(1);

    const message = buildMulticastMessage(event, ['tok'], { nowMs: NOW });
    expect(message.android.notification.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_STATUS);
    expect(message.android.notification.tag).toBe(`drivelocal_ride_location_${RIDE}`);
    expect(message.notification.title).toBe('Passageiro sem sua localização');
    expect(message.data).not.toHaveProperty('incidentNumber');
  });

  it('drops an alert that became obsolete: map moving again, ride over, or expired', async () => {
    const { db, events } = await staleWithToken(DRIVER);
    const driverEvent = events().find((e) => e.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE);
    const passengerEvent = events().find((e) => e.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_DELAYED);

    // Point fresh again: the passenger reassurance is pointless.
    await db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(RIDE).set(trackingDoc(NOW, { location: FRESH_POINT }));
    const m = messaging();
    expect(await run(db, passengerEvent, NOW + 1_000, m))
      .toEqual({ skipped: true, reasonCode: 'RIDE_LOCATION_ALERT_OBSOLETE' });

    // Ride cancelled meanwhile.
    await db.collection(C.RIDE_REQUESTS).doc(RIDE).set({ status: C.RIDE_STATUS.CANCELLED }, { merge: true });
    expect((await run(db, driverEvent, NOW + 1_000, m)).skipped).toBe(true);
    expect(m.sendEach).not.toHaveBeenCalled();
    expect(db._store.get(`${C.NOTIFICATION_EVENTS}/${driverEvent.notificationId}`))
      .toMatchObject({ status: C.NOTIFICATION_STATUS.SKIPPED, reasonCode: 'RIDE_LOCATION_ALERT_OBSOLETE' });
  });

  it('refuses expired alerts and alerts from a closed incident', () => {
    const ride = rideDoc();
    const event = { eventType: C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE, recipientUid: DRIVER, incidentNumber: 1, expiresAtMs: NOW + 60_000 };
    const health = { state: 'stale', incidentNumber: 1 };
    expect(guard.shouldSendRideLocationAlert({ ride, health, event, nowMs: NOW })).toBe(true);
    expect(guard.shouldSendRideLocationAlert({ ride, health, event, nowMs: NOW + 61_000 })).toBe(false);
    expect(guard.shouldSendRideLocationAlert({ ride, health: { state: 'healthy', incidentNumber: 1 }, event, nowMs: NOW })).toBe(false);
    expect(guard.shouldSendRideLocationAlert({ ride, health: { state: 'stale', incidentNumber: 2 }, event, nowMs: NOW })).toBe(false);
    expect(guard.shouldSendRideLocationAlert({ ride, health, event: { ...event, recipientUid: 'intruder' }, nowMs: NOW })).toBe(false);
  });
});
