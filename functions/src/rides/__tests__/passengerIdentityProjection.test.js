'use strict';

const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const {
  PROJECTION_VERSION,
  closedProjection,
  identityProjectionNeeded,
  syncAcceptedPassengerIdentity,
} = require('../passengerIdentityProjection');
const C = require('../constants');

const RIDE_ID = 'ride_identity_001';
const DRIVER_ID = 'driver_identity_001';
const PASSENGER_ID = 'passenger_identity_001';
const OFFER_ID = `${RIDE_ID}_${DRIVER_ID}`;
const PHOTO_VERSION = 'photo_public_20260726';
const PHOTO_PATH = `publicPassengerPhotos/${PHOTO_VERSION}.jpg`;
const CONTEXT = { traceId: 'trace_passenger_identity', environment: 'test' };

async function seed(db, passenger = {}) {
  await db.collection(C.RIDE_REQUESTS).doc(RIDE_ID).set({
    rideId: RIDE_ID,
    passengerId: PASSENGER_ID,
    acceptedDriverId: DRIVER_ID,
    status: C.RIDE_STATUS.ASSIGNED,
  });
  await db.collection(C.DRIVER_OFFERS).doc(OFFER_ID).set({
    rideId: RIDE_ID,
    driverId: DRIVER_ID,
    status: C.OFFER_STATUS.ACCEPTED,
    driverRideStatus: C.RIDE_STATUS.ASSIGNED,
  });
  await db.collection(C.PASSENGERS).doc(PASSENGER_ID).set(passenger);
}

describe('accepted passenger identity projection trigger', () => {
  it('runs only after assignment and when the closed projection is missing or malformed', () => {
    expect(identityProjectionNeeded({}, { status: C.RIDE_STATUS.SEARCHING })).toBe(false);
    expect(identityProjectionNeeded({}, {
      status: C.RIDE_STATUS.ASSIGNED,
      passengerId: PASSENGER_ID,
      acceptedDriverId: DRIVER_ID,
    })).toBe(true);
    expect(identityProjectionNeeded({}, {
      status: C.RIDE_STATUS.ASSIGNED,
      passengerId: PASSENGER_ID,
      acceptedDriverId: DRIVER_ID,
      acceptedPassengerPublic: {
        firstName: 'Maria',
        photoStoragePath: null,
        photoVerified: false,
        email: 'must-not-survive@example.com',
      },
    })).toBe(true);
    expect(identityProjectionNeeded({ acceptedPassengerPublic: {
      firstName: 'Maria', photoStoragePath: null, photoVerified: false,
    } }, {
      status: C.RIDE_STATUS.ASSIGNED,
      passengerId: PASSENGER_ID,
      acceptedDriverId: DRIVER_ID,
      acceptedPassengerPublic: {
        firstName: 'Maria', photoStoragePath: null, photoVerified: false,
      },
    })).toBe(false);
  });

  it('accepts only the exact three-field shape', () => {
    expect(closedProjection({ firstName: 'Maria', photoStoragePath: null, photoVerified: false }))
      .toEqual({ firstName: 'Maria', photoStoragePath: null, photoVerified: false });
    expect(closedProjection({ firstName: 'Maria', photoStoragePath: null, photoVerified: false, phone: 'x' }))
      .toBeNull();
    expect(closedProjection({ firstName: 'Maria', photoStoragePath: PHOTO_PATH, photoVerified: false }))
      .toBeNull();
  });

  it('writes the same minimal identity to the private ride and accepted driver offer', async () => {
    const db = makeFakeFirestore();
    await seed(db, {
      fullName: 'Maria Clara de Souza',
      email: 'private@example.com',
      whatsApp: '85999999999',
      passengerPhotoPublicVerified: true,
      passengerPhotoPublicVersion: PHOTO_VERSION,
      passengerPhotoPublicPath: PHOTO_PATH,
    });

    const result = await syncAcceptedPassengerIdentity({ db, rideId: RIDE_ID, context: CONTEXT });
    expect(result.action).toBe('succeeded');

    const ride = db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`);
    const offer = db._store.get(`${C.DRIVER_OFFERS}/${OFFER_ID}`);
    const expected = { firstName: 'Maria', photoStoragePath: PHOTO_PATH, photoVerified: true };
    expect(ride.acceptedPassengerPublic).toEqual(expected);
    expect(offer.acceptedPassengerPublic).toEqual(expected);
    expect(ride.passengerIdentityProjectionVersion).toBe(PROJECTION_VERSION);
    expect(offer.passengerIdentityProjectionVersion).toBe(PROJECTION_VERSION);

    const driverProjection = JSON.stringify(offer.acceptedPassengerPublic);
    expect(driverProjection).not.toContain(PASSENGER_ID);
    expect(driverProjection).not.toContain('private@example.com');
    expect(driverProjection).not.toContain('85999999999');
    expect(driverProjection).not.toContain('Clara');
  });

  it('is idempotent and does not rewrite a matching projection', async () => {
    const db = makeFakeFirestore();
    await seed(db, { fullName: 'Carlos Eduardo' });
    await syncAcceptedPassengerIdentity({ db, rideId: RIDE_ID, context: CONTEXT });
    const second = await syncAcceptedPassengerIdentity({ db, rideId: RIDE_ID, context: CONTEXT });
    expect(second.action).toBe('duplicate_ignored');
  });

  it('uses a generic first name when the private passenger profile is missing', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.RIDE_REQUESTS).doc(RIDE_ID).set({
      rideId: RIDE_ID,
      passengerId: PASSENGER_ID,
      acceptedDriverId: DRIVER_ID,
      status: C.RIDE_STATUS.ASSIGNED,
    });
    await db.collection(C.DRIVER_OFFERS).doc(OFFER_ID).set({
      rideId: RIDE_ID,
      driverId: DRIVER_ID,
      status: C.OFFER_STATUS.ACCEPTED,
    });

    await syncAcceptedPassengerIdentity({ db, rideId: RIDE_ID, context: CONTEXT });
    const offer = db._store.get(`${C.DRIVER_OFFERS}/${OFFER_ID}`);
    expect(offer.acceptedPassengerPublic).toEqual({
      firstName: 'Passageiro',
      photoStoragePath: null,
      photoVerified: false,
    });
  });
});
