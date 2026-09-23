const { getRideQuoteSecure, QUOTE_TTL_MS } = require('../rideQuote');
const { createRideRequestSecure } = require('../createRideRequest');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const C = require('../constants');

jest.mock('../dispatchWaveTask', () => ({
  scheduleRideDispatchTasks: jest.fn(async () => ({ scheduledWaveCount: 0 })),
  runDispatchWave: jest.fn(async () => ({ status: 'searching', reasonCode: 'SEARCH_CONTINUES' })),
}));

const pickup = { lat: -4.1000, lng: -38.4900, label: 'Origem teste' };
const destination = { lat: -4.1150, lng: -38.5050, label: 'Destino teste' };
const route = { computeRoute: jest.fn(async () => ({ distanceMeters: 5000, durationSeconds: 900 })) };
let nowMs;
const clock = { now: () => nowMs };
const context = { traceId: 'trace-quote-test', environment: 'test' };

function req(uid, data) { return { auth: { uid }, data }; }
function seed() {
  const db = makeFakeFirestore();
  db.collection(C.CITY_PUBLIC_CONFIG).doc(C.DEFAULT_SERVICE_AREA_ID).set({
    active: true, allowedVehicleTypes: ['moto', 'car'], boundaryVersion: '2024.1',
  });
  db.collection(C.PASSENGERS).doc('p1').set({ activeRideId: null });
  db.collection(C.PASSENGERS).doc('p2').set({ activeRideId: null });
  return db;
}
async function quote(db, vehicleType = 'car') {
  return getRideQuoteSecure({
    db, request: req('p1', { vehicleType, pickup, destination }), context, clock,
    routingAdapter: route,
  });
}
async function confirm(db, q, override = {}) {
  return createRideRequestSecure({
    db, request: req('p1', {
      vehicleType: q.vehicleType, pickup, destination,
      quoteId: q.quoteId, idempotencyKey: 'quote-confirm-key-001', ...override,
    }), context, clock, routingAdapter: route, requireQuote: true,
  });
}
function rides(db) {
  return [...db._store.keys()].filter((key) => key.startsWith(`${C.RIDE_REQUESTS}/`));
}

describe('server quote before passenger confirmation', () => {
  beforeEach(() => { nowMs = Date.parse('2026-09-23T12:00:00Z'); route.computeRoute.mockClear(); });

  it('returns the exact price before any ride or driver offer exists; confirmation uses it once', async () => {
    const db = seed();
    const q = await quote(db);
    expect(q).toMatchObject({ vehicleType: 'car', routeDistanceMeters: 5000,
      routeDurationSeconds: 900, traceId: context.traceId, peakApplied: false });
    expect(q.estimatedFareCentavos).toBeGreaterThan(0);
    expect(rides(db)).toHaveLength(0);
    expect([...db._store.keys()].filter((key) => key.startsWith(`${C.DRIVER_OFFERS}/`))).toHaveLength(0);
    const first = await confirm(db, q);
    expect(first.estimatedFareCentavos).toBe(q.estimatedFareCentavos);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${first.rideId}`).pricingConfigVersion)
      .toBe(q.pricingConfigVersion);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${first.rideId}`).traceId).toBe(q.traceId);
    expect(rides(db)).toHaveLength(1);
    expect(route.computeRoute).toHaveBeenCalledTimes(1);
    nowMs += QUOTE_TTL_MS;
    expect((await confirm(db, q)).rideId).toBe(first.rideId);
    expect(rides(db)).toHaveLength(1);
    await expect(confirm(db, q, { idempotencyKey: 'different-confirm-key-001' }))
      .rejects.toMatchObject({ code: 'QUOTE_USED' });
  });

  it('rejects expired, foreign and changed-trip quotes without creating a ride', async () => {
    const expiredDb = seed();
    const old = await quote(expiredDb);
    nowMs += QUOTE_TTL_MS;
    await expect(confirm(expiredDb, old)).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    expect(rides(expiredDb)).toHaveLength(0);

    const foreignDb = seed();
    const foreign = await quote(foreignDb, 'moto');
    await expect(confirm(foreignDb, foreign, { destination: { ...destination, lat: -4.11 } }))
      .rejects.toMatchObject({ code: 'QUOTE_MISMATCH' });
    await expect(createRideRequestSecure({
      db: foreignDb, request: req('p2', { vehicleType: 'moto', pickup, destination,
        quoteId: foreign.quoteId, idempotencyKey: 'other-user-confirm-001' }),
      context, clock, routingAdapter: route, requireQuote: true,
    })).rejects.toMatchObject({ code: 'QUOTE_MISMATCH' });
    expect(rides(foreignDb)).toHaveLength(0);
  });

  it('requires a server quote on the new confirmation callable', async () => {
    const db = seed();
    await expect(confirm(db, { vehicleType: 'car' }))
      .rejects.toMatchObject({ code: 'QUOTE_MISMATCH' });
    expect(rides(db)).toHaveLength(0);
  });

  it('keeps the exact peak supplement inside the confirmed fare', async () => {
    nowMs = Date.parse('2026-09-23T22:00:00Z'); // 19h in Horizonte.
    const db = seed();
    const q = await quote(db, 'moto');
    expect(q.peakApplied).toBe(true);
    expect(q.peakSurchargeCentavos).toBeGreaterThan(0);
    const ride = await confirm(db, q);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${ride.rideId}`).peakSurchargeCentavos)
      .toBe(q.peakSurchargeCentavos);
    expect(ride.estimatedFareCentavos).toBe(q.estimatedFareCentavos);
  });
});
