const { assertCancellationAllowed, cancellationActor } = require('../cancelRide');
const { PASSENGER_NO_SHOW_WAIT_MS } = require('../cancellationPolicy');

describe('secure cancel ride guards', () => {
  it('derives the actor only from authenticated ride ownership', () => {
    const ride = { passengerId: 'passenger-1', acceptedDriverId: 'driver-1' };
    expect(cancellationActor(ride, 'passenger-1')).toBe('passenger');
    expect(cancellationActor(ride, 'driver-1')).toBe('driver');
    expect(cancellationActor(ride, 'outsider')).toBeNull();
  });

  it('allows a passenger reason only for the passenger role', () => {
    expect(() => assertCancellationAllowed({
      ride: { status: 'assigned' },
      role: 'passenger',
      reasonCode: 'driver_delayed',
      nowMs: 1000,
    })).not.toThrow();

    expect(() => assertCancellationAllowed({
      ride: { status: 'assigned' },
      role: 'driver',
      reasonCode: 'driver_delayed',
      nowMs: 1000,
    })).toThrow();
  });

  it('does not allow cancellation after the ride starts', () => {
    expect(() => assertCancellationAllowed({
      ride: { status: 'in_progress' },
      role: 'passenger',
      reasonCode: 'passenger_safety_concern',
      nowMs: 1000,
    })).toThrow();
  });

  it('requires arrival and three minutes before passenger no-show', () => {
    const arrivedAtMs = 1_000_000;
    expect(() => assertCancellationAllowed({
      ride: { status: 'driver_arrived', driverArrivedAtMs: arrivedAtMs },
      role: 'driver',
      reasonCode: 'passenger_no_show',
      nowMs: arrivedAtMs + PASSENGER_NO_SHOW_WAIT_MS - 1,
    })).toThrow();

    expect(() => assertCancellationAllowed({
      ride: { status: 'driver_arrived', driverArrivedAtMs: arrivedAtMs },
      role: 'driver',
      reasonCode: 'passenger_no_show',
      nowMs: arrivedAtMs + PASSENGER_NO_SHOW_WAIT_MS,
    })).not.toThrow();
  });

  it('allows other driver cancellations before pickup without the no-show timer', () => {
    expect(() => assertCancellationAllowed({
      ride: { status: 'assigned' },
      role: 'driver',
      reasonCode: 'vehicle_problem',
      nowMs: 1000,
    })).not.toThrow();
  });
});