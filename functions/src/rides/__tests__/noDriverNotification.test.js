// @ts-check
// The passenger must learn that his search ended with nobody found.
//
// Before continuous search this was implicit: the refusal came back within two
// seconds of the request, while the passenger was still looking at his screen.
// A search now runs for the whole window, so he may have locked the phone long
// before it ends. Without this notification he would only discover the outcome
// by reopening the app, which on a launch operation where most requests end
// without a driver is the normal case, not an edge case.

const { expireRideOffers } = require('../expireOffersTask');
const C = require('../constants');

const T0 = 1_760_000_000_000;

function fakeDb({ ride, offers = [], passenger }) {
  const store = new Map();
  if (ride) store.set(`${C.RIDE_REQUESTS}/${ride.rideId}`, ride);
  if (passenger) store.set(`${C.PASSENGERS}/${passenger.id}`, passenger.data);
  offers.forEach((o) => store.set(`${C.DRIVER_OFFERS}/${o.id}`, o.data));

  const writes = [];

  function ref(path) {
    return { path, id: path.split('/').pop() };
  }

  const offersQuery = {
    _kind: 'offers',
    docs: () => offers.map((o) => ({
      id: o.id,
      ref: ref(`${C.DRIVER_OFFERS}/${o.id}`),
      data: () => store.get(`${C.DRIVER_OFFERS}/${o.id}`),
    })),
  };

  const db = {
    _store: store,
    _writes: writes,
    collection: (name) => ({
      doc: (id) => ref(`${name}/${id}`),
      where: () => offersQuery,
    }),
    runTransaction: async (fn) => fn({
      get: async (target) => {
        if (target && target._kind === 'offers') {
          const docs = offersQuery.docs();
          return { forEach: (cb) => docs.forEach(cb), docs };
        }
        const data = store.get(target.path);
        return { exists: Boolean(data), data: () => data };
      },
      set: (target, data) => {
        writes.push({ path: target.path, data });
        store.set(target.path, { ...(store.get(target.path) || {}), ...data });
      },
    }),
  };
  return db;
}

function expiredOffer(id, rideId) {
  return {
    id,
    data: { rideId, status: C.OFFER_STATUS.OFFERED, expiresAtMs: T0 - 1_000 },
  };
}

function notificationWrites(db) {
  return db._writes.filter((w) => w.path.startsWith(`${C.NOTIFICATION_EVENTS}/`));
}

describe('search closed with no driver', () => {
  it('notifies the passenger when the search ends empty', async () => {
    const db = fakeDb({
      ride: {
        rideId: 'ride_1',
        status: C.RIDE_STATUS.SEARCHING,
        passengerId: 'pax_1',
      },
      offers: [expiredOffer('ride_1_d1', 'ride_1'), expiredOffer('ride_1_d2', 'ride_1')],
      passenger: { id: 'pax_1', data: { activeRideId: 'ride_1' } },
    });

    const result = await expireRideOffers({ db, rideId: 'ride_1', nowMs: T0, context: {} });

    expect(result.outcome).toBe('search_closed');
    expect(result.passengerNotified).toBe(true);

    const events = notificationWrites(db);
    expect(events).toHaveLength(1);
    expect(events[0].data.eventType).toBe(C.NOTIFICATION_EVENT.RIDE_NO_DRIVER);
    expect(events[0].data.recipientUid).toBe('pax_1');
    expect(events[0].data.recipientRole).toBe('passenger');
    // Allowed by every installed client version and needs no rideId, so old
    // builds route the tap safely instead of dropping it.
    expect(events[0].data.route).toBe('/passenger-home');
    expect(events[0].data.status).toBe(C.NOTIFICATION_STATUS.PENDING);
  });

  it('never notifies while a live offer remains', async () => {
    const db = fakeDb({
      ride: { rideId: 'ride_2', status: C.RIDE_STATUS.SEARCHING, passengerId: 'pax_2' },
      offers: [
        expiredOffer('ride_2_d1', 'ride_2'),
        { id: 'ride_2_d2', data: { rideId: 'ride_2', status: C.OFFER_STATUS.OFFERED, expiresAtMs: T0 + 30_000 } },
      ],
      passenger: { id: 'pax_2', data: { activeRideId: 'ride_2' } },
    });

    const result = await expireRideOffers({ db, rideId: 'ride_2', nowMs: T0, context: {} });

    expect(result.outcome).toBe('live_offers_remain');
    expect(result.passengerNotified).toBe(false);
    expect(notificationWrites(db)).toHaveLength(0);
  });

  it('never notifies a ride that left SEARCHING', async () => {
    // Accepted, cancelled or already closed: the passenger has his real outcome
    // through the normal lifecycle events and must not get a false "no driver".
    for (const status of [
      C.RIDE_STATUS.ASSIGNED,
      C.RIDE_STATUS.CANCELLED,
      C.RIDE_STATUS.COMPLETED,
      C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
    ]) {
      const db = fakeDb({
        ride: { rideId: 'ride_3', status, passengerId: 'pax_3' },
        offers: [expiredOffer('ride_3_d1', 'ride_3')],
        passenger: { id: 'pax_3', data: { activeRideId: null } },
      });

      const result = await expireRideOffers({ db, rideId: 'ride_3', nowMs: T0, context: {} });

      expect(result.outcome).toBe(`ride_${status}`);
      expect(result.passengerNotified).toBe(false);
      expect(notificationWrites(db)).toHaveLength(0);
    }
  });

  it('closes an empty search and still notifies when no offer was ever created', async () => {
    // The common launch case: no eligible driver at any wave. The ride stayed
    // SEARCHING for the whole window and ends here with zero offers.
    const db = fakeDb({
      ride: { rideId: 'ride_4', status: C.RIDE_STATUS.SEARCHING, passengerId: 'pax_4' },
      offers: [],
      passenger: { id: 'pax_4', data: { activeRideId: 'ride_4' } },
    });

    const result = await expireRideOffers({ db, rideId: 'ride_4', nowMs: T0, context: {} });

    expect(result.outcome).toBe('search_closed');
    expect(result.expiredOfferCount).toBe(0);
    expect(result.passengerNotified).toBe(true);
    expect(result.passengerStateCleared).toBe(true);
  });

  it('closes the search without a notification when the ride has no passenger', async () => {
    const db = fakeDb({
      ride: { rideId: 'ride_5', status: C.RIDE_STATUS.SEARCHING, passengerId: null },
      offers: [expiredOffer('ride_5_d1', 'ride_5')],
    });

    const result = await expireRideOffers({ db, rideId: 'ride_5', nowMs: T0, context: {} });

    expect(result.outcome).toBe('search_closed');
    expect(result.passengerNotified).toBe(false);
    expect(notificationWrites(db)).toHaveLength(0);
  });

  it('is idempotent: a replayed close cannot double-notify', async () => {
    // Deterministic event ids mean a retried task re-uses the same document, so
    // the Firestore onCreate trigger still fires exactly once.
    const db = fakeDb({
      ride: { rideId: 'ride_6', status: C.RIDE_STATUS.SEARCHING, passengerId: 'pax_6' },
      offers: [expiredOffer('ride_6_d1', 'ride_6')],
      passenger: { id: 'pax_6', data: { activeRideId: 'ride_6' } },
    });

    await expireRideOffers({ db, rideId: 'ride_6', nowMs: T0, context: {} });
    const firstId = notificationWrites(db)[0].path;

    // Replay against the state the first run produced.
    db._writes.length = 0;
    db._store.set(`${C.RIDE_REQUESTS}/ride_6`, {
      rideId: 'ride_6',
      status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
      passengerId: 'pax_6',
    });
    const replay = await expireRideOffers({ db, rideId: 'ride_6', nowMs: T0, context: {} });

    expect(replay.passengerNotified).toBe(false);
    expect(notificationWrites(db)).toHaveLength(0);
    expect(firstId).toContain(C.NOTIFICATION_EVENT.RIDE_NO_DRIVER);
  });

  it('does nothing for a ride that no longer exists', async () => {
    const db = fakeDb({ ride: null });
    const result = await expireRideOffers({ db, rideId: 'ride_gone', nowMs: T0, context: {} });

    expect(result.outcome).toBe('ride_missing');
    expect(result.passengerNotified).toBe(false);
    expect(notificationWrites(db)).toHaveLength(0);
  });
});
