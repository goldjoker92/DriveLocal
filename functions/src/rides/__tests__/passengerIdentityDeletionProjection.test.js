'use strict';

const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const {
  DELETED_PASSENGER_PUBLIC,
  identityProjectionNeeded,
  syncAcceptedPassengerIdentity,
} = require('../passengerIdentityProjection');
const C = require('../constants');

const RIDE_ID = 'ride_deleted_passenger_001';
const DRIVER_ID = 'driver_deleted_passenger_001';
const ANONYMOUS_PASSENGER_ID = 'deleted_passenger_opaque_001';
const OFFER_ID = `${RIDE_ID}_${DRIVER_ID}`;
const CONTEXT = { traceId: 'trace_deleted_passenger', environment: 'test' };

async function seedDeletedRide(db) {
  await db.collection(C.RIDE_REQUESTS).doc(RIDE_ID).set({
    rideId: RIDE_ID,
    passengerId: ANONYMOUS_PASSENGER_ID,
    passengerDeleted: true,
    acceptedDriverId: DRIVER_ID,
    status: C.RIDE_STATUS.COMPLETED,
    acceptedPassengerPublic: DELETED_PASSENGER_PUBLIC,
  });
  await db.collection(C.DRIVER_OFFERS).doc(OFFER_ID).set({
    rideId: RIDE_ID,
    driverId: DRIVER_ID,
    status: C.OFFER_STATUS.ACCEPTED,
    driverRideStatus: C.RIDE_STATUS.COMPLETED,
    acceptedPassengerPublic: {
      firstName: 'Maria',
      photoStoragePath: 'publicPassengerPhotos/photo_public_20260726.jpg',
      photoVerified: true,
    },
  });
}

describe('passenger deletion identity propagation', () => {
  it('schedules one projection when passengerDeleted first becomes true', () => {
    const before = {
      passengerId: 'passenger_original',
      acceptedDriverId: DRIVER_ID,
      status: C.RIDE_STATUS.COMPLETED,
      acceptedPassengerPublic: {
        firstName: 'Maria',
        photoStoragePath: null,
        photoVerified: false,
      },
    };
    const after = {
      ...before,
      passengerId: ANONYMOUS_PASSENGER_ID,
      passengerDeleted: true,
      acceptedPassengerPublic: DELETED_PASSENGER_PUBLIC,
    };

    expect(identityProjectionNeeded(before, after)).toBe(true);
    expect(identityProjectionNeeded(after, after)).toBe(false);
  });

  it('removes the former name and photo from the accepted driver offer', async () => {
    const db = makeFakeFirestore();
    await seedDeletedRide(db);

    const result = await syncAcceptedPassengerIdentity({
      db,
      rideId: RIDE_ID,
      context: CONTEXT,
    });

    expect(result.action).toBe('succeeded');
    expect(result.accountDeleted).toBe(true);
    const offer = db._store.get(`${C.DRIVER_OFFERS}/${OFFER_ID}`);
    expect(offer.acceptedPassengerPublic).toEqual(DELETED_PASSENGER_PUBLIC);
    const serialized = JSON.stringify(offer.acceptedPassengerPublic);
    expect(serialized).not.toContain('Maria');
    expect(serialized).not.toContain('photo_public_20260726');
  });

  it('does not require the deleted private passenger profile to exist', async () => {
    const db = makeFakeFirestore();
    await seedDeletedRide(db);
    expect(db._store.has(`${C.PASSENGERS}/${ANONYMOUS_PASSENGER_ID}`)).toBe(false);

    await expect(syncAcceptedPassengerIdentity({
      db,
      rideId: RIDE_ID,
      context: CONTEXT,
    })).resolves.toMatchObject({
      action: 'succeeded',
      accountDeleted: true,
    });
  });
});
