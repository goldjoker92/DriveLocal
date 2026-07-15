// Deterministic unit tests for BLOCK 07+08 (ride request, dispatch, acceptance,
// wallet hold). In-memory fake Firestore + injected fake routing provider — no
// emulator, no cloud, no real Google Routes call. Exactly the 10 critical
// invariants required by the block.
//
// The fake routing adapter and fakeFirestore are TEST-ONLY; runtime exports build
// the real Google Routes adapter and use the Firebase Admin SDK (verified by
// git grep in the validation step).

const { createRideRequestSecure } = require('../rides/createRideRequest');
const { acceptDriverOfferSecure } = require('../rides/acceptOffer');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const T0 = 1_700_000_000_000;
const ctx = { traceId: 'trace_ride', environment: 'emulator' };

// Horizonte square polygon; pickup/destination are inside, SP is outside.
const BOUNDARY = {
  type: 'Polygon',
  coordinates: [[[-38.55, -4.15], [-38.45, -4.15], [-38.45, -4.05], [-38.55, -4.05], [-38.55, -4.15]]],
};
const PICKUP = { lat: -4.10, lng: -38.49, label: 'Centro' };
const DEST_IN = { lat: -4.11, lng: -38.5 };
const DEST_OUT = { lat: -23.55, lng: -46.63 }; // São Paulo — out of area

// Fixed route: 3 km / 10 min -> moto fare 655, commission 79 (12% capped ok).
function fakeRouting(over = {}) {
  const calls = [];
  return {
    calls,
    async computeRoute(p) {
      calls.push(p);
      if (over.fail) throw over.fail;
      return { distanceMeters: 3000, durationSeconds: 600 };
    },
  };
}

function seedCity(db) {
  db.collection(C.CITY_PUBLIC_CONFIG).doc(C.DEFAULT_SERVICE_AREA_ID).set({
    active: true,
    allowedVehicleTypes: ['moto', 'car'],
    boundary: BOUNDARY,
    offerTtlSeconds: 15,
    searchRadiusMeters: 5000,
    maxCandidates: 25,
  });
}

function seedDriver(db, id, over = {}) {
  db.collection(C.DRIVERS).doc(id).set({
    serviceAreaId: C.DEFAULT_SERVICE_AREA_ID,
    vehicleType: 'moto',
    verificationStatus: 'approved',
    isBlocked: false,
    availabilityStatus: 'online',
    activeRideId: null,
    location: { lat: -4.10, lng: -38.49 },
    locationUpdatedAtMs: T0,
    // Founder -> commission-free + subscription-covered by default.
    founderEligible: true,
    commissionFreeUntil: T0 + 60 * 24 * 60 * 60 * 1000,
    subscriptionFreeUntil: T0 + 60 * 24 * 60 * 60 * 1000,
    walletBalanceCentavos: 0,
    walletAvailableCentavos: 0,
    walletHeldCentavos: 0,
    ...over,
  });
}

function paxReq(uid, data) {
  return { auth: { uid }, data };
}

async function createRide(db, clock, routing, uid = 'pax1', over = {}) {
  return createRideRequestSecure({
    db,
    request: paxReq(uid, {
      vehicleType: 'moto',
      pickup: PICKUP,
      destination: DEST_IN,
      idempotencyKey: `ride-${uid}-000001`,
      ...over,
    }),
    context: ctx,
    clock,
    routingAdapter: routing,
  });
}

function offersFor(db, rideId) {
  const ids = [];
  for (const key of db._store.keys()) {
    if (key.startsWith(`${C.DRIVER_OFFERS}/${rideId}_`)) ids.push(key.slice(`${C.DRIVER_OFFERS}/`.length));
  }
  return ids;
}
function holdCount(db, rideId) {
  let n = 0;
  for (const key of db._store.keys()) if (key === `${C.WALLET_TRANSACTIONS}/${rideId}_hold`) n += 1;
  return n;
}

describe('ride creation & geofence & pricing authority', () => {
  it('T1: unauthenticated ride creation is rejected', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    await expect(
      createRideRequestSecure({
        db,
        request: { data: { vehicleType: 'moto', pickup: PICKUP, destination: DEST_IN, idempotencyKey: 'ride-anon-0001' } },
        context: ctx,
        clock: fixedClock(T0),
        routingAdapter: fakeRouting(),
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('T2: a destination outside Horizonte is rejected', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    const routing = fakeRouting();
    await expect(createRide(db, fixedClock(T0), routing, 'pax1', { destination: DEST_OUT })).rejects.toMatchObject({
      code: 'OUT_OF_SERVICE_AREA',
    });
    expect(routing.calls.length).toBe(0); // routing not called for out-of-area
  });

  it('T3: client fare/distance is ignored; the server quote is used', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'dA');
    // A client-supplied fare field is an unknown field -> rejected outright.
    await expect(
      createRide(db, fixedClock(T0), fakeRouting(), 'pax1', { estimatedFareCentavos: 1 })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    // A valid call prices from the provider route (3 km/10 min): moto fare 655.
    const view = await createRide(db, fixedClock(T0), fakeRouting(), 'pax2');
    expect(view.estimatedFareCentavos).toBe(655);
    expect(view.routeDistanceMeters).toBe(3000);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${view.rideId}`).estimatedCommissionCentavos).toBe(79);

    // Routing failure aborts creation WITHOUT persisting an incomplete ride.
    const db2 = makeFakeFirestore();
    seedCity(db2);
    await expect(
      createRide(db2, fixedClock(T0), fakeRouting({ fail: new Error('down') }))
    ).rejects.toBeDefined();
    let rides = 0;
    for (const key of db2._store.keys()) if (key.startsWith(`${C.RIDE_REQUESTS}/`)) rides += 1;
    expect(rides).toBe(0);
  });
});

describe('dispatch targeting', () => {
  it('T4: only eligible matching drivers receive targeted offers', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'ok1'); // eligible
    seedDriver(db, 'ok2'); // eligible
    seedDriver(db, 'offline', { availabilityStatus: 'offline' });
    seedDriver(db, 'car', { vehicleType: 'car' });
    seedDriver(db, 'blocked', { isBlocked: true });
    seedDriver(db, 'unapproved', { verificationStatus: 'pending_review' });
    seedDriver(db, 'stale', { locationUpdatedAtMs: T0 - 10 * 60 * 1000 });
    seedDriver(db, 'far', { location: { lat: -4.14, lng: -38.54 } }); // ~ >5 km away? within box but far
    seedDriver(db, 'busy', { activeRideId: 'other' });

    const view = await createRide(db, fixedClock(T0), fakeRouting());
    const offered = offersFor(db, view.rideId).sort();
    expect(offered).toContain(`${view.rideId}_ok1`);
    expect(offered).toContain(`${view.rideId}_ok2`);
    expect(offered).not.toContain(`${view.rideId}_offline`);
    expect(offered).not.toContain(`${view.rideId}_car`);
    expect(offered).not.toContain(`${view.rideId}_blocked`);
    expect(offered).not.toContain(`${view.rideId}_unapproved`);
    expect(offered).not.toContain(`${view.rideId}_stale`);
    expect(offered).not.toContain(`${view.rideId}_busy`);
    expect(view.status).toBe(C.RIDE_STATUS.SEARCHING);
  });

  it('T5: no eligible driver yields a controlled no_driver_available result', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'offline', { availabilityStatus: 'offline' });
    const view = await createRide(db, fixedClock(T0), fakeRouting());
    expect(view.status).toBe(C.RIDE_STATUS.NO_DRIVER_AVAILABLE);
    expect(view.reasonCode).toBe(C.REASON.NO_ELIGIBLE_DRIVERS);
    expect(offersFor(db, view.rideId).length).toBe(0);
  });
});

describe('transactional acceptance & wallet hold', () => {
  it('T6: concurrent acceptance allows exactly one winner', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'A');
    seedDriver(db, 'B');
    const clock = fixedClock(T0);
    const view = await createRide(db, clock, fakeRouting());

    const won = await acceptDriverOfferSecure({
      db, request: { auth: { uid: 'A' }, data: { offerId: `${view.rideId}_A`, idempotencyKey: 'acc-A-00000001' } }, context: ctx, clock,
    });
    expect(won.status).toBe(C.RIDE_STATUS.ASSIGNED);

    await expect(
      acceptDriverOfferSecure({ db, request: { auth: { uid: 'B' }, data: { offerId: `${view.rideId}_B`, idempotencyKey: 'acc-B-00000001' } }, context: ctx, clock })
    ).rejects.toMatchObject({ code: 'RIDE_ALREADY_ACCEPTED' });

    expect(db._store.get(`${C.RIDE_REQUESTS}/${view.rideId}`).acceptedDriverId).toBe('A');
  });

  it('T7: an expired or foreign offer is rejected', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'A');
    seedDriver(db, 'B');
    const clock = fixedClock(T0);
    const view = await createRide(db, clock, fakeRouting());

    // Foreign: driver B tries to accept A's offer.
    await expect(
      acceptDriverOfferSecure({ db, request: { auth: { uid: 'B' }, data: { offerId: `${view.rideId}_A`, idempotencyKey: 'acc-foreign-01' } }, context: ctx, clock })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Expired: advance past the 15 s offer TTL.
    const late = fixedClock(T0 + 16 * 1000);
    await expect(
      acceptDriverOfferSecure({ db, request: { auth: { uid: 'A' }, data: { offerId: `${view.rideId}_A`, idempotencyKey: 'acc-expired-01' } }, context: ctx, clock: late })
    ).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
  });

  it('T8: a commission-free driver accepts with wallet R$0 and hold R$0', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'F', { walletAvailableCentavos: 0, walletBalanceCentavos: 0 }); // founder, commission-free
    const clock = fixedClock(T0);
    const view = await createRide(db, clock, fakeRouting());

    const won = await acceptDriverOfferSecure({
      db, request: { auth: { uid: 'F' }, data: { offerId: `${view.rideId}_F`, idempotencyKey: 'acc-free-000001' } }, context: ctx, clock,
    });
    expect(won.status).toBe(C.RIDE_STATUS.ASSIGNED);
    expect(won.commissionHoldCentavos).toBe(0);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${view.rideId}`).commissionHoldCentavos).toBe(0);
    expect(holdCount(db, view.rideId)).toBe(0); // no hold document when not required
  });

  it('T9: a post-promotion driver requires eligibility, wallet > R$3 and enough balance', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    // Standard driver: no commission-free, active subscription (eligible).
    const standard = {
      founderEligible: false,
      commissionFreeUntil: null,
      subscriptionFreeUntil: null,
      subscriptionActive: true,
      subscriptionExpiresAt: T0 + 10 * 24 * 60 * 60 * 1000,
    };
    seedDriver(db, 'S', { ...standard, walletAvailableCentavos: 100 }); // <= R$3,00
    const clock = fixedClock(T0);
    const view = await createRide(db, clock, fakeRouting());

    await expect(
      acceptDriverOfferSecure({ db, request: { auth: { uid: 'S' }, data: { offerId: `${view.rideId}_S`, idempotencyKey: 'acc-poor-000001' } }, context: ctx, clock })
    ).rejects.toMatchObject({ code: 'WALLET_INSUFFICIENT' });

    // Top up above threshold and enough to cover commission (79).
    db.collection(C.DRIVERS).doc('S').set({ walletAvailableCentavos: 5000 }, { merge: true });
    const won = await acceptDriverOfferSecure({
      db, request: { auth: { uid: 'S' }, data: { offerId: `${view.rideId}_S`, idempotencyKey: 'acc-ok-00000001' } }, context: ctx, clock,
    });
    expect(won.commissionHoldCentavos).toBe(79);
    expect(db._store.get(`${C.DRIVERS}/S`).walletHeldCentavos).toBe(79);
    expect(db._store.get(`${C.DRIVERS}/S`).walletAvailableCentavos).toBe(5000 - 79);
  });

  it('T10: duplicate acceptance creates exactly one hold and one assignment', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    const standard = {
      founderEligible: false,
      commissionFreeUntil: null,
      subscriptionActive: true,
      subscriptionExpiresAt: T0 + 10 * 24 * 60 * 60 * 1000,
      walletAvailableCentavos: 5000,
    };
    seedDriver(db, 'S', standard);
    const clock = fixedClock(T0);
    const view = await createRide(db, clock, fakeRouting());

    const req = { auth: { uid: 'S' }, data: { offerId: `${view.rideId}_S`, idempotencyKey: 'acc-dup-0000001' } };
    const first = await acceptDriverOfferSecure({ db, request: req, context: ctx, clock });
    const second = await acceptDriverOfferSecure({ db, request: req, context: ctx, clock });

    expect(first.status).toBe(C.RIDE_STATUS.ASSIGNED);
    expect(second.status).toBe(C.RIDE_STATUS.ASSIGNED);
    expect(holdCount(db, view.rideId)).toBe(1); // one hold
    expect(db._store.get(`${C.DRIVERS}/S`).walletHeldCentavos).toBe(79); // not doubled
    expect(db._store.get(`${C.RIDE_REQUESTS}/${view.rideId}`).acceptedDriverId).toBe('S');
  });
});

describe('exact pickup privacy & coordinate gating', () => {
  it('E1: the winning driver receives exactPickup only after a successful acceptance', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'A');
    const clock = fixedClock(T0);
    const view = await createRide(db, clock, fakeRouting());

    // Before acceptance the offer has only a coarsened preview, no exactPickup.
    expect(db._store.get(`${C.DRIVER_OFFERS}/${view.rideId}_A`).exactPickup).toBeUndefined();
    expect(db._store.get(`${C.DRIVER_OFFERS}/${view.rideId}_A`).pickupPreview).toBeDefined();

    const won = await acceptDriverOfferSecure({
      db, request: { auth: { uid: 'A' }, data: { offerId: `${view.rideId}_A`, idempotencyKey: 'acc-A-00000001' } }, context: ctx, clock,
    });
    expect(won.pickup).toMatchObject({ lat: PICKUP.lat, lng: PICKUP.lng });
    const offer = db._store.get(`${C.DRIVER_OFFERS}/${view.rideId}_A`);
    expect(offer.status).toBe(C.OFFER_STATUS.ACCEPTED);
    expect(offer.exactPickup).toMatchObject({ lat: PICKUP.lat, lng: PICKUP.lng });
  });

  it('E2: losing / expired / failed offers never receive exactPickup', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    seedDriver(db, 'A');
    seedDriver(db, 'B');
    const clock = fixedClock(T0);
    const view = await createRide(db, clock, fakeRouting());

    await acceptDriverOfferSecure({
      db, request: { auth: { uid: 'A' }, data: { offerId: `${view.rideId}_A`, idempotencyKey: 'acc-A-00000002' } }, context: ctx, clock,
    });
    // Loser B (lost the first-wins race) never gets exactPickup.
    await expect(
      acceptDriverOfferSecure({ db, request: { auth: { uid: 'B' }, data: { offerId: `${view.rideId}_B`, idempotencyKey: 'acc-B-00000002' } }, context: ctx, clock })
    ).rejects.toMatchObject({ code: 'RIDE_ALREADY_ACCEPTED' });
    expect(db._store.get(`${C.DRIVER_OFFERS}/${view.rideId}_B`).exactPickup).toBeUndefined();

    // A failed (expired) acceptance also never exposes exactPickup.
    const db2 = makeFakeFirestore();
    seedCity(db2);
    seedDriver(db2, 'A');
    const v2 = await createRide(db2, fixedClock(T0), fakeRouting());
    await expect(
      acceptDriverOfferSecure({ db: db2, request: { auth: { uid: 'A' }, data: { offerId: `${v2.rideId}_A`, idempotencyKey: 'acc-exp-000001' } }, context: ctx, clock: fixedClock(T0 + 16 * 1000) })
    ).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
    expect(db2._store.get(`${C.DRIVER_OFFERS}/${v2.rideId}_A`).exactPickup).toBeUndefined();
  });

  it('E3: a free-text address without resolved coordinates cannot request a ride', async () => {
    const db = makeFakeFirestore();
    seedCity(db);
    await expect(
      createRideRequestSecure({
        db,
        request: { auth: { uid: 'pax1' }, data: { vehicleType: 'moto', pickup: { label: 'Centro, Horizonte' }, destination: DEST_IN, idempotencyKey: 'ride-notext-01' } },
        context: ctx,
        clock: fixedClock(T0),
        routingAdapter: fakeRouting(),
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
