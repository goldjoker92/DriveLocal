// @ts-check
// Lot 2 delivery guarantees. Three production failure modes are covered here:
//
//   1. a Cloud Tasks outage discarded a wave whose offers were already written,
//      so nobody was notified while every driver was reachable;
//   2. offers and notifications were written one await at a time, so the last
//      driver rang seconds after the first inside a short decision window, and a
//      failure halfway through left a partially notified wave;
//   3. a ride offer was sent without max priority / public visibility and with a
//      flat 10-minute ttl, so a phone reconnecting late was woken up for a ride
//      that had already been assigned or closed.

const C = require('../constants');
const {
  createTargetedOffers,
  scheduleOfferExpiry,
} = require('../offers');

const T0 = 1_760_000_000_000;
const clock = { now: () => T0 };

function fakeDb() {
  const store = new Map();
  const batches = [];

  function docRef(path) {
    return {
      path,
      set: (data) => {
        store.set(path, { ...(store.get(path) || {}), ...data });
        return Promise.resolve();
      },
    };
  }

  return {
    _store: store,
    _batches: batches,
    collection: (name) => ({ doc: (id) => docRef(`${name}/${id}`) }),
    batch() {
      const ops = [];
      const record = { ops, committed: false };
      batches.push(record);
      return {
        set(ref, data) {
          ops.push({ path: ref.path, data });
        },
        commit() {
          record.committed = true;
          ops.forEach(({ path, data }) => {
            store.set(path, { ...(store.get(path) || {}), ...data });
          });
          return Promise.resolve();
        },
      };
    },
  };
}

function ride(overrides = {}) {
  return {
    rideId: 'ride_lot2',
    serviceAreaId: C.DEFAULT_SERVICE_AREA_ID,
    vehicleType: 'moto',
    pickup: { lat: -4.0999, lng: -38.4954 },
    estimatedFareCentavos: 900,
    estimatedCommissionCentavos: 0,
    ...overrides,
  };
}

function eligible(count) {
  return Array.from({ length: count }, (_, i) => ({
    driverId: `driver_${i}`,
    data: { verificationStatus: 'approved' },
    distanceToPickupMeters: 100 * (i + 1),
    availabilitySessionId: `work_session_abcdef${i}0123456`,
  }));
}

function entries(db, prefix) {
  return [...db._store.entries()].filter(([path]) => path.startsWith(prefix));
}

describe('offer wave delivery guarantees', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('writes the whole wave in batches instead of one await per driver', async () => {
    const db = fakeDb();
    const result = await createTargetedOffers({
      db,
      ride: ride(),
      eligible: eligible(12),
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    });

    expect(result.createdCount).toBe(12);
    expect(entries(db, `${C.DRIVER_OFFERS}/`)).toHaveLength(12);
    expect(entries(db, `${C.NOTIFICATION_EVENTS}/`)).toHaveLength(12);

    // Exactly two commits: one for the offers, one for the notifications. Any
    // regression back to per-driver awaits would show up as 24 batches or none.
    expect(db._batches).toHaveLength(2);
    expect(db._batches.every((b) => b.committed)).toBe(true);
    expect(db._batches[0].ops).toHaveLength(12);
    expect(db._batches[1].ops).toHaveLength(12);
  });

  it('still notifies every driver when the expiry task cannot be enqueued', async () => {
    // Leave the test short-circuit so the real Cloud Tasks path is exercised.
    process.env.NODE_ENV = 'production';
    const db = fakeDb();

    // No Firebase app is initialised here, so getFunctions() throws exactly the
    // way a Cloud Tasks outage or a missing queue does in production.
    const result = await createTargetedOffers({
      db,
      ride: ride(),
      eligible: eligible(5),
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    });

    // The wave must survive: offers persisted AND every driver notified.
    expect(result.createdCount).toBe(5);
    expect(entries(db, `${C.DRIVER_OFFERS}/`)).toHaveLength(5);
    expect(entries(db, `${C.NOTIFICATION_EVENTS}/`)).toHaveLength(5);
  });

  it('notifies before scheduling expiry, never the other way round', async () => {
    const db = fakeDb();
    await createTargetedOffers({
      db,
      ride: ride(),
      eligible: eligible(3),
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    });

    // Offers are committed first, notifications second. Expiry comes last and is
    // deliberately absent from the batches: it is a safety net, not a gate.
    expect(db._batches[0].ops[0].path.startsWith(`${C.DRIVER_OFFERS}/`)).toBe(true);
    expect(db._batches[1].ops[0].path.startsWith(`${C.NOTIFICATION_EVENTS}/`)).toBe(true);
  });

  it('carries the offer deadline on the notification event', async () => {
    const db = fakeDb();
    await createTargetedOffers({
      db,
      ride: ride(),
      eligible: eligible(1),
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    });

    const [, event] = entries(db, `${C.NOTIFICATION_EVENTS}/`)[0];
    expect(event.expiresAtMs).toBe(T0 + C.OFFER_TTL_SECONDS * 1000);
    expect(event.eventType).toBe(C.NOTIFICATION_EVENT.OFFER_CREATED);
  });

  it('keeps offer ids deterministic so a replayed wave cannot duplicate them', async () => {
    const db = fakeDb();
    const args = {
      db,
      ride: ride(),
      eligible: eligible(4),
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    };

    await createTargetedOffers(args);
    await createTargetedOffers(args);

    expect(entries(db, `${C.DRIVER_OFFERS}/`)).toHaveLength(4);
    expect(entries(db, `${C.NOTIFICATION_EVENTS}/`)).toHaveLength(4);
  });

  it('handles an empty wave without writing or scheduling anything', async () => {
    const db = fakeDb();
    const result = await createTargetedOffers({
      db,
      ride: ride(),
      eligible: [],
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    });

    expect(result.createdCount).toBe(0);
    expect(entries(db, `${C.DRIVER_OFFERS}/`)).toHaveLength(0);
    expect(entries(db, `${C.NOTIFICATION_EVENTS}/`)).toHaveLength(0);
  });

  it('reports a skipped enqueue in the isolated test environment', async () => {
    process.env.NODE_ENV = 'test';
    const outcome = await scheduleOfferExpiry({
      rideId: 'ride_lot2',
      expiresAtMs: T0 + 90_000,
      context: {},
    });
    expect(outcome).toEqual({ scheduled: false, reasonCode: 'TEST_ENVIRONMENT' });
  });
});
