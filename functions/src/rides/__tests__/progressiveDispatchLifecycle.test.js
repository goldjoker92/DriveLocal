const crypto = require('crypto');
const { fixedClock } = require('../../time/clock');
const { expireRideOffers } = require('../expireOffersTask');
const { finishSearchWhenNoLiveOffer } = require('../declineOffer');
const { createTargetedOffers } = require('../offers');
const { runDispatchWave } = require('../dispatchWaveTask');
const C = require('../constants');

const T0 = 1_800_000_000_000;
const RIDE_ID = 'ride_progressive_1';
const PASSENGER_ID = 'passenger_1';
const context = { traceId: 'trace_progressive_test' };

// Purpose-built transactional Firestore double for this contract. Keeping it
// local means the regression test can be added to branches whose older shared
// test helper did not yet support transaction.get(query).
function makeFakeFirestore() {
  const store = new Map();
  let autoSequence = 0;

  function docRef(collectionName, suppliedId) {
    const id = suppliedId || `auto_${(autoSequence += 1)}`;
    const key = `${collectionName}/${id}`;
    const ref = {
      id,
      _key: key,
      async get() {
        const data = store.get(key);
        return { exists: data !== undefined, id, data: () => data, ref };
      },
      async set(data, options) {
        const previous = store.get(key);
        store.set(key, options?.merge && previous ? { ...previous, ...data } : { ...data });
      },
    };
    return ref;
  }

  function query(collectionName, filters = [], cap = null) {
    return {
      where(field, operator, value) {
        return query(collectionName, [...filters, { field, operator, value }], cap);
      },
      limit(value) {
        return query(collectionName, filters, Number(value));
      },
      async get() {
        const prefix = `${collectionName}/`;
        const docs = [];
        for (const [key, data] of store.entries()) {
          if (!key.startsWith(prefix)) continue;
          const matches = filters.every((filter) => (
            filter.operator === '==' && data?.[filter.field] === filter.value
          ));
          if (!matches) continue;
          const id = key.slice(prefix.length);
          docs.push({ id, data: () => data, ref: docRef(collectionName, id) });
        }
        const bounded = cap == null ? docs : docs.slice(0, cap);
        return {
          size: bounded.length,
          docs: bounded,
          forEach: (callback) => bounded.forEach(callback),
        };
      },
    };
  }

  return {
    _store: store,
    collection(collectionName) {
      return {
        doc: (id) => docRef(collectionName, id),
        where: (field, operator, value) => query(
          collectionName,
          [{ field, operator, value }]
        ),
      };
    },
    async runTransaction(callback) {
      const tx = {
        async get(target) {
          if (!target?._key && typeof target?.get === 'function') return target.get();
          const data = store.get(target._key);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref, data, options) {
          const previous = store.get(ref._key);
          store.set(
            ref._key,
            options?.merge && previous ? { ...previous, ...data } : { ...data }
          );
        },
      };
      return callback(tx);
    },
  };
}

async function seedRide(db, over = {}) {
  await db.collection(C.RIDE_REQUESTS).doc(RIDE_ID).set({
    rideId: RIDE_ID,
    passengerId: PASSENGER_ID,
    serviceAreaId: C.DEFAULT_SERVICE_AREA_ID,
    vehicleType: 'moto',
    pickup: { lat: -4.1, lng: -38.49 },
    destination: { lat: -4.11, lng: -38.5 },
    estimatedFareCentavos: 750,
    estimatedCommissionCentavos: 0,
    status: C.RIDE_STATUS.SEARCHING,
    createdAtMs: T0,
    searchExpiresAtMs: T0 + 90_000,
    dispatchWaveIndexesAttempted: [0],
    lastDispatchWaveIndex: 0,
    offeredDriverIds: [],
    ...over,
  });
  await db.collection(C.PASSENGERS).doc(PASSENGER_ID).set({ activeRideId: RIDE_ID });
}

async function seedCity(db) {
  const boundary = {
    type: 'Polygon',
    coordinates: [[
      [-38.65, -4.25],
      [-38.35, -4.25],
      [-38.35, -3.95],
      [-38.65, -3.95],
      [-38.65, -4.25],
    ]],
  };
  await db.collection(C.CITY_PUBLIC_CONFIG).doc(C.DEFAULT_SERVICE_AREA_ID).set({
    active: true,
    serviceAreaId: C.DEFAULT_SERVICE_AREA_ID,
    municipalityCode: '2305233',
    boundaryVersion: 'test-progressive-v1',
    operationalPolygonVersion: 'test-progressive-v1',
    allowedVehicleTypes: ['moto', 'car'],
    boundaryFormat: 'geojson-geometry-json-v1',
    boundaryGeoJson: JSON.stringify(boundary),
    boundaryChecksum: crypto
      .createHash('sha256')
      .update(JSON.stringify(boundary.coordinates))
      .digest('hex'),
    boundaryBoundingBox: [-38.65, -4.25, -38.35, -3.95],
  });
}

async function seedDriver(db, driverId, location) {
  const availabilitySessionId = `work_${driverId}_session_123456789`;
  await db.collection(C.DRIVERS).doc(driverId).set({
    serviceAreaId: C.DEFAULT_SERVICE_AREA_ID,
    vehicleType: 'moto',
    verificationStatus: 'approved',
    isBlocked: false,
    availabilityStatus: 'online',
    availabilitySessionId,
    availabilityUpdatedAtMs: T0,
    activeRideId: null,
    location,
    locationUpdatedAtMs: T0,
    locationAvailabilitySessionId: availabilitySessionId,
    founderEligible: true,
    commissionFreeUntil: T0 + 100_000,
    subscriptionFreeUntil: T0 + 100_000,
    availabilityClientBuildNumber: 17,
    availabilityClientSessionId: availabilitySessionId,
    availabilityClientUpdatedAtMs: T0,
    pixKeyType: 'CPF',
    pixKey: '529.982.247-25',
  });
}

async function seedOffer(db, over = {}) {
  await db.collection(C.DRIVER_OFFERS).doc(`${RIDE_ID}_driver_1`).set({
    rideId: RIDE_ID,
    driverId: 'driver_1',
    status: C.OFFER_STATUS.OFFERED,
    expiresAtMs: T0 + 30_000,
    ...over,
  });
}

describe('progressive dispatch lifecycle', () => {
  it('expires a 30-second offer without closing the 90-second passenger search', async () => {
    const db = makeFakeFirestore();
    await seedRide(db);
    await seedOffer(db);

    const result = await expireRideOffers({
      db,
      rideId: RIDE_ID,
      nowMs: T0 + 31_000,
      context,
    });

    expect(result.outcome).toBe('search_continues');
    expect(db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`).status)
      .toBe(C.RIDE_STATUS.SEARCHING);
    expect(db._store.get(`${C.PASSENGERS}/${PASSENGER_ID}`).activeRideId)
      .toBe(RIDE_ID);
    expect(db._store.get(`${C.DRIVER_OFFERS}/${RIDE_ID}_driver_1`).status)
      .toBe(C.OFFER_STATUS.CLOSED);
  });

  it('closes the ride and passenger state only at the global deadline', async () => {
    const db = makeFakeFirestore();
    await seedRide(db);
    await seedOffer(db, { expiresAtMs: T0 + 120_000 });

    const result = await expireRideOffers({
      db,
      rideId: RIDE_ID,
      nowMs: T0 + 91_000,
      context,
    });

    expect(result.outcome).toBe('search_closed');
    expect(db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`).status)
      .toBe(C.RIDE_STATUS.NO_DRIVER_AVAILABLE);
    expect(db._store.get(`${C.PASSENGERS}/${PASSENGER_ID}`).activeRideId).toBeNull();
    expect(db._store.get(`${C.DRIVER_OFFERS}/${RIDE_ID}_driver_1`).status)
      .toBe(C.OFFER_STATUS.CLOSED);
  });

  it('keeps searching after all drivers decline early', async () => {
    const db = makeFakeFirestore();
    await seedRide(db);
    await seedOffer(db, { status: C.OFFER_STATUS.CLOSED });

    const closed = await finishSearchWhenNoLiveOffer({
      db,
      rideId: RIDE_ID,
      nowMs: T0 + 5_000,
      context,
    });

    expect(closed).toBe(false);
    const ride = db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`);
    expect(ride.status).toBe(C.RIDE_STATUS.SEARCHING);
    expect(ride.reasonCode).toBe(C.REASON.SEARCH_CONTINUES);
    expect(db._store.get(`${C.PASSENGERS}/${PASSENGER_ID}`).activeRideId)
      .toBe(RIDE_ID);
  });

  it('does not recreate or re-notify an existing deterministic offer', async () => {
    const db = makeFakeFirestore();
    await seedRide(db);
    const candidate = {
      driverId: 'driver_1',
      availabilitySessionId: 'session_driver_1_123456',
      distanceToPickupMeters: 400,
      data: { founderEligible: true, commissionFreeUntil: T0 + 100_000 },
    };
    const ride = {
      ...db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`),
      dispatchWaveIndex: 0,
      dispatchWaveRadiusMeters: 3_000,
      dispatchWaveTrigger: 'test',
    };

    const first = await createTargetedOffers({
      db,
      ride,
      eligible: [candidate],
      offerTtlSeconds: 30,
      traceId: context.traceId,
      context,
      clock: fixedClock(T0),
    });
    await db.collection(C.DRIVER_OFFERS).doc(`${RIDE_ID}_driver_1`).set({
      status: C.OFFER_STATUS.CLOSED,
      declineReason: 'driver_declined',
    }, { merge: true });
    const replay = await createTargetedOffers({
      db,
      ride,
      eligible: [candidate],
      offerTtlSeconds: 30,
      traceId: context.traceId,
      context,
      clock: fixedClock(T0 + 1_000),
    });

    expect(first.createdCount).toBe(1);
    expect(replay.createdCount).toBe(0);
    expect(db._store.get(`${C.DRIVER_OFFERS}/${RIDE_ID}_driver_1`).status)
      .toBe(C.OFFER_STATUS.CLOSED);
    const events = [...db._store.keys()].filter((key) => key.startsWith(`${C.NOTIFICATION_EVENTS}/`));
    expect(events).toHaveLength(1);
  });

  it('skips empty rings immediately and still re-queries scheduled radii later', async () => {
    const db = makeFakeFirestore();
    await seedCity(db);
    await seedRide(db);
    // Roughly 8.9 km north of pickup: outside 3/6 km, inside 10 km.
    await seedDriver(db, 'driver_far', { lat: -4.02, lng: -38.49 });

    const initial = await runDispatchWave({
      db,
      rideId: RIDE_ID,
      waveIndex: 0,
      trigger: 'test_initial',
      expandIfEmpty: true,
      context,
      clock: fixedClock(T0),
    });

    expect(initial.offersCreated).toBe(1);
    expect(initial.lastWaveIndex).toBe(2);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`).dispatchWaveIndexesAttempted)
      .toEqual([0, 1, 2]);
    expect(db._store.has(`${C.DRIVER_OFFERS}/${RIDE_ID}_driver_far`)).toBe(true);

    // A driver comes online around 5.5 km after the early expansion. The normal
    // t+15s wave still re-queries 6 km and reaches that newcomer exactly once.
    await seedDriver(db, 'driver_new', { lat: -4.05, lng: -38.49 });
    const scheduled = await runDispatchWave({
      db,
      rideId: RIDE_ID,
      waveIndex: 1,
      trigger: 'test_scheduled',
      expandIfEmpty: false,
      context,
      clock: fixedClock(T0 + 15_000),
    });

    expect(scheduled.offersCreated).toBe(1);
    const newOffer = db._store.get(`${C.DRIVER_OFFERS}/${RIDE_ID}_driver_new`);
    expect(newOffer.dispatchWaveIndex).toBe(1);
    expect(newOffer.dispatchWaveRadiusMeters).toBe(6_000);
  });
});
