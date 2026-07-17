const { acceptDriverOfferSecure } = require('../rides/acceptOffer');
const lifecycle = require('../rides/lifecycle');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const NOW = Date.parse('2026-08-02T03:07:00.000Z');
const DRIVER = 'driver_live_location';
const PASSENGER = 'passenger_live_location';
const RIDE = 'ride_live_location';
const OFFER = `${RIDE}_${DRIVER}`;

function req(uid, data) {
  return { auth: { uid }, data };
}

function seed(db) {
  db.collection(C.DRIVERS).doc(DRIVER).set({
    verificationStatus: 'approved',
    founderEligible: false,
    freeRideCountUsed: 5,
    subscriptionActive: true,
    subscriptionExpiresAt: NOW + 30 * 864e5,
    isBlocked: false,
    availabilityStatus: 'online',
    activeRideId: null,
    vehicleType: 'moto',
    fullName: 'Motorista Live',
    walletBalanceCentavos: 1000,
    walletAvailableCentavos: 1000,
    walletHeldCentavos: 0,
    location: { lat: -4.0995358, lng: -38.5006227 },
    locationAccuracyMeters: 7,
    locationHeadingDegrees: 90,
    locationSpeedMps: 4.5,
    locationUpdatedAtMs: NOW,
  });

  db.collection(C.RIDE_REQUESTS).doc(RIDE).set({
    rideId: RIDE,
    passengerId: PASSENGER,
    status: C.RIDE_STATUS.SEARCHING,
    vehicleType: 'moto',
    pickup: { lat: -4.0995358, lng: -38.5006227, label: 'Embarque' },
    destination: { lat: -4.10497, lng: -38.44969, label: 'Destino' },
    estimatedFareCentavos: 774,
    estimatedCommissionCentavos: 93,
  });

  db.collection(C.DRIVER_OFFERS).doc(OFFER).set({
    rideId: RIDE,
    driverId: DRIVER,
    vehicleType: 'moto',
    status: C.OFFER_STATUS.OFFERED,
    expiresAtMs: NOW + 15_000,
  });

  db.collection(C.PRIVATE_DRIVER_DATA).doc(DRIVER).set({
    pixKey: 'live-location@example.com',
    pixOwnerName: 'Motorista Live',
  });
}

describe('active ride live location lifecycle', () => {
  it('creates one current point on acceptance and deletes it before payment', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(NOW);
    seed(db);

    await acceptDriverOfferSecure({
      db,
      request: req(DRIVER, { offerId: OFFER, idempotencyKey: 'accept-live-location-001' }),
      context: { traceId: 'trace_live_location' },
      clock,
    });

    expect(db._store.get(`${C.ACTIVE_RIDE_LOCATIONS}/${RIDE}`)).toMatchObject({
      rideId: RIDE,
      driverId: DRIVER,
      vehicleType: 'moto',
      location: { lat: -4.0995358, lng: -38.5006227 },
      accuracyMeters: 7,
      headingDegrees: 90,
      speedMps: 4.5,
    });

    await lifecycle.markDriverArrived({
      db,
      request: req(DRIVER, { rideId: RIDE, idempotencyKey: 'arrive-live-location-001' }),
      context: {},
      clock,
    });
    await lifecycle.startRide({
      db,
      request: req(DRIVER, { rideId: RIDE, idempotencyKey: 'start-live-location-0001' }),
      context: {},
      clock,
    });

    expect(db._store.has(`${C.ACTIVE_RIDE_LOCATIONS}/${RIDE}`)).toBe(true);

    await lifecycle.finishRide({
      db,
      request: req(DRIVER, { rideId: RIDE, idempotencyKey: 'finish-live-location-001' }),
      context: {},
      clock,
    });

    expect(db._store.has(`${C.ACTIVE_RIDE_LOCATIONS}/${RIDE}`)).toBe(false);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${RIDE}`).status).toBe(C.RIDE_STATUS.AWAITING_PAYMENT);
  });

  it('deletes the current point when either party cancels', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(NOW);
    seed(db);

    await acceptDriverOfferSecure({
      db,
      request: req(DRIVER, { offerId: OFFER, idempotencyKey: 'accept-live-cancel-0001' }),
      context: {},
      clock,
    });
    expect(db._store.has(`${C.ACTIVE_RIDE_LOCATIONS}/${RIDE}`)).toBe(true);

    await lifecycle.cancelRide({
      db,
      request: req(PASSENGER, {
        rideId: RIDE,
        idempotencyKey: 'cancel-live-location-001',
        reasonCode: 'passageiro_cancelou',
      }),
      context: {},
      clock,
    });

    expect(db._store.has(`${C.ACTIVE_RIDE_LOCATIONS}/${RIDE}`)).toBe(false);
    expect(db._store.get(`${C.RIDE_REQUESTS}/${RIDE}`).status).toBe(C.RIDE_STATUS.CANCELLED);
  });
});
