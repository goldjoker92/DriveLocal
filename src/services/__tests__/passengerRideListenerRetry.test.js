// A Firestore listener error is terminal. The passenger map must come back by
// itself instead of staying empty until the passenger leaves the screen.

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db, collection, id) => ({ path: `${collection}/${id}` })),
  onSnapshot: jest.fn(),
}));
jest.mock('../../config/firebase', () => ({ auth: { currentUser: { uid: 'passenger_1' } }, db: {} }));
jest.mock('../../utils/clientRideLog', () => ({ logRideClientEvent: jest.fn() }));
jest.mock('../networkRecoveryService', () => ({
  clearRideRecoveryHint: jest.fn(async () => undefined),
  reportFirestoreListenerError: jest.fn(),
  reportFirestoreSnapshot: jest.fn(),
  saveRideRecoveryHint: jest.fn(async () => undefined),
}));

const { onSnapshot } = require('firebase/firestore');
const { logRideClientEvent } = require('../../utils/clientRideLog');
const {
  listenToPassengerRide,
  listenToPassengerRideLocation,
} = require('../passengerRideLiveListeners');

const listeners = [];
const snap = (data, id = 'ride_retry_1') => ({
  id, exists: () => data != null, data: () => data, metadata: { fromCache: false },
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.length = 0;
  onSnapshot.mockImplementation((ref, _options, onNext, onError) => {
    const listener = { path: ref.path, onNext, onError, unsubscribe: jest.fn() };
    listeners.push(listener);
    return listener.unsubscribe;
  });
});

afterEach(() => jest.useRealTimers());

it('re-attaches the ride point listener after an error and delivers the same point again', () => {
  const onData = jest.fn();
  const onError = jest.fn();
  const stop = listenToPassengerRideLocation('ride_retry_1', onData, onError);
  const point = { location: { lat: -4.09, lng: -38.49 }, updatedAtMs: 1 };

  listeners[0].onNext(snap(point));
  listeners[0].onError(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(listeners[0].unsubscribe).toHaveBeenCalled();

  jest.advanceTimersByTime(2_000);
  expect(listeners).toHaveLength(2);
  // Same point as before the error: it must still reach the map, which reset it.
  listeners[1].onNext(snap(point));
  expect(onData).toHaveBeenCalledTimes(2);
  expect(logRideClientEvent).toHaveBeenCalledWith(
    'ride.location.listener_retry_scheduled',
    expect.objectContaining({ delayMs: 2_000, attempt: 1 })
  );
  stop();
});

it('backs off on repeated errors and resets after a good snapshot', () => {
  const stop = listenToPassengerRideLocation('ride_retry_2', jest.fn(), jest.fn());
  listeners[0].onError(new Error('e1'));
  jest.advanceTimersByTime(2_000);
  listeners[1].onError(new Error('e2'));
  jest.advanceTimersByTime(4_999);
  expect(listeners).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(listeners).toHaveLength(3);

  listeners[2].onNext(snap(null, 'ride_retry_2'));
  listeners[2].onError(new Error('e3'));
  jest.advanceTimersByTime(2_000);
  expect(listeners).toHaveLength(4);
  stop();
});

it('stops retrying once nobody listens anymore', () => {
  const stop = listenToPassengerRideLocation('ride_retry_3', jest.fn(), jest.fn());
  listeners[0].onError(new Error('e1'));
  stop();
  jest.advanceTimersByTime(60_000);
  expect(listeners).toHaveLength(1);
});

it('re-attaches the ride document listener too', () => {
  const onData = jest.fn();
  const stop = listenToPassengerRide('ride_retry_4', onData, jest.fn());
  listeners[0].onError(new Error('unavailable'));
  jest.advanceTimersByTime(2_000);
  expect(listeners).toHaveLength(2);
  listeners[1].onNext(snap({ status: 'assigned', passengerId: 'passenger_1' }, 'ride_retry_4'));
  expect(onData).toHaveBeenCalledWith(expect.objectContaining({ status: 'assigned' }));
  stop();
});
