const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const {
  clearPassengerActiveRideIfCurrent,
} = require('../createRideRequest');
const C = require('../constants');

describe('passenger active ride cleanup', () => {
  it('clears the failed ride only when it is still the passenger current ride', async () => {
    const db = makeFakeFirestore();
    const passengerRef = db.collection(C.PASSENGERS).doc('p1');
    await passengerRef.set({ activeRideId: 'ride-1' });

    await expect(clearPassengerActiveRideIfCurrent({
      db,
      passengerId: 'p1',
      rideId: 'ride-1',
    })).resolves.toBe(true);
    expect((await passengerRef.get()).data().activeRideId).toBeNull();
  });

  it('does not erase a newer ride created after the old search ended', async () => {
    const db = makeFakeFirestore();
    const passengerRef = db.collection(C.PASSENGERS).doc('p1');
    await passengerRef.set({ activeRideId: 'ride-2' });

    await expect(clearPassengerActiveRideIfCurrent({
      db,
      passengerId: 'p1',
      rideId: 'ride-1',
    })).resolves.toBe(false);
    expect((await passengerRef.get()).data().activeRideId).toBe('ride-2');
  });
});
