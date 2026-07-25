// @ts-check

const { createRideRequestSecure } = require('../rides/createRideRequest');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const { ERROR_CODES } = require('../errors/appError');
const C = require('../rides/constants');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

describe('restricted passenger ride creation', () => {
  it('fails before route calculation or dispatch', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.PASSENGERS).doc('p1').set({
      riskBlockedFromNewRides: true,
      riskRestrictionUntilMs: NOW + 3600000,
      activeRideId: null,
    });
    let routeCalled = false;

    await expect(createRideRequestSecure({
      db,
      request: {
        auth: { uid: 'p1' },
        data: {
          vehicleType: 'moto',
          pickup: { lat: -4.1, lng: -38.5 },
          destination: { lat: -4.11, lng: -38.49 },
          idempotencyKey: 'restricted-passenger-ride-01',
        },
      },
      context: { traceId: 'trace_restricted_passenger' },
      clock: fixedClock(NOW),
      routingAdapter: {
        async computeRoute() {
          routeCalled = true;
          return { distanceMeters: 1000, durationSeconds: 300 };
        },
      },
    })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      safeMetadata: {
        reason: 'PASSENGER_TEMPORARILY_RESTRICTED',
      },
    });

    expect(routeCalled).toBe(false);
    expect([...db._store.keys()].some((key) => key.startsWith(`${C.RIDE_REQUESTS}/`))).toBe(false);
  });
});
