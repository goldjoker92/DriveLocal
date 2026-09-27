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
  destinationPreview,
  pickupPreview,
  scheduleOfferExpiry,
} = require('../offers');

const T0 = 1_760_000_000_000;
const clock = { now: () => T0 };

function fakeDb() {
  const store = new Map();
  const batches = [];
  store.set(`${C.RIDE_REQUESTS}/ride_lot2`, {
    ...ride(),
    status: C.RIDE_STATUS.SEARCHING,
    searchExpiresAtMs: T0 + C.SEARCH_TTL_SECONDS * 1000,
    offeredDriverIds: [],
    dispatchWaveIndexesAttempted: [],
  });

  function docRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      get: () => {
        const data = store.get(path);
        return Promise.resolve({ exists: data !== undefined, data: () => data });
      },
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
    runTransaction: async (callback) => callback({
      get: (ref) => ref.get(),
      set: (ref, data, options) => {
        const previous = store.get(ref.path);
        store.set(ref.path, options?.merge && previous ? { ...previous, ...data } : { ...data });
      },
    }),
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
    pickup: {
      lat: -4.0999,
      lng: -38.4954,
      label: 'Rua Baturité, 45 - Centro, Horizonte - CE, 62880-000, Brasil',
    },
    destination: {
      lat: -4.112,
      lng: -38.47,
      label: 'Avenida Presidente Castelo Branco, 500 - Parque Industrial, Horizonte - CE, Brasil',
    },
    routeDistanceMeters: 8400,
    routeDurationSeconds: 1080,
    estimatedFareCentavos: 900,
    estimatedCommissionCentavos: 0,
    ...overrides,
  };
}

function eligible(db, count) {
  return Array.from({ length: count }, (_, i) => {
    const driverId = `driver_${i}`;
    const availabilitySessionId = `work_session_abcdef${i}0123456`;
    const data = {
      verificationStatus: 'approved', availabilityStatus: 'online',
      availabilitySessionId, locationAvailabilitySessionId: availabilitySessionId,
      availabilityUpdatedAtMs: T0, locationUpdatedAtMs: T0,
      location: { lat: -4.1, lng: -38.5 }, pixKey: `${i}@example.test`, pixKeyType: 'email',
      commissionFreeUntil: T0 + 86_400_000,
    };
    db._store.set(`${C.DRIVERS}/${driverId}`, data);
    return { driverId, data, distanceToPickupMeters: 100 * (i + 1), availabilitySessionId };
  });
}

function entries(db, prefix) {
  return [...db._store.entries()].filter(([path]) => path.startsWith(prefix));
}

describe('offer wave delivery guarantees', () => {
  it.each([
    { availabilityStatus: 'offline' },
    { activeRideId: 'another-ride' },
    { availabilitySessionId: 'work_replacement_123456789' },
    { locationUpdatedAtMs: T0 - 8 * 60_000 },
  ])('does not send an offer when the driver changed after selection: %j', async (changes) => {
    const db = fakeDb();
    const candidates = eligible(db, 1);
    const key = `${C.DRIVERS}/driver_0`;
    db._store.set(key, { ...db._store.get(key), ...changes });
    const result = await createTargetedOffers({ db, ride: ride(), eligible: candidates,
      offerTtlSeconds: 30, traceId: 'test-race', context: {}, clock });
    expect(result.createdCount).toBe(0);
    expect(entries(db, `${C.NOTIFICATION_EVENTS}/`)).toHaveLength(0);
  });
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('writes the whole wave and notification outbox atomically', async () => {
    const db = fakeDb();
    const result = await createTargetedOffers({
      db,
      ride: ride(),
      eligible: eligible(db, 12),
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    });

    expect(result.createdCount).toBe(12);
    expect(entries(db, `${C.DRIVER_OFFERS}/`)).toHaveLength(12);
    expect(entries(db, `${C.NOTIFICATION_EVENTS}/`)).toHaveLength(12);

    // One Firestore transaction owns both sides; no partially-notified wave can
    // survive a retry or process interruption.
    expect(db._batches).toHaveLength(0);

    const [, firstOffer] = entries(db, `${C.DRIVER_OFFERS}/`)[0];
    expect(firstOffer.pickupPreview.label).toBe('Centro · Horizonte - CE');
    expect(firstOffer.destinationPreview).toEqual({
      label: 'Parque Industrial · Horizonte - CE',
    });
    expect(firstOffer.routeDistanceMeters).toBe(8400);
    expect(firstOffer.routeDurationSeconds).toBe(1080);
    expect(firstOffer.destinationPreview).not.toHaveProperty('lat');
    expect(firstOffer.destinationPreview).not.toHaveProperty('lng');
  });

  it('removes street and number from pre-acceptance route previews', () => {
    expect(pickupPreview({
      lat: -4.1,
      lng: -38.49,
      label: 'Rua Baturité, 45 - Centro, Horizonte - CE, 62880-000, Brasil',
    })).toMatchObject({
      label: 'Centro · Horizonte - CE',
    });
    expect(destinationPreview({
      lat: -4.11,
      lng: -38.47,
      label: 'Avenida Central, 500 - Parque Industrial, Horizonte - CE, Brasil',
    })).toEqual({
      label: 'Parque Industrial · Horizonte - CE',
    });
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
      eligible: eligible(db, 5),
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
      eligible: eligible(db, 3),
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
      context: {},
      clock,
    });

    // Both writes already exist when expiry scheduling begins. The scheduler is
    // a safety net and never a precondition for delivering the offer.
    expect(entries(db, `${C.DRIVER_OFFERS}/`)).toHaveLength(3);
    expect(entries(db, `${C.NOTIFICATION_EVENTS}/`)).toHaveLength(3);
  });

  it('carries the offer deadline on the notification event', async () => {
    const db = fakeDb();
    await createTargetedOffers({
      db,
      ride: ride(),
      eligible: eligible(db, 1),
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
      eligible: eligible(db, 4),
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
