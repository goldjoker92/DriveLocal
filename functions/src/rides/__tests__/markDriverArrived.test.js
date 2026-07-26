jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
}));

const C = require('../constants');
const { PASSENGER_NO_SHOW_WAIT_MS } = require('../cancellationPolicy');
const { markDriverArrived } = require('../markDriverArrived');

function createFirestore(initialDocuments) {
  const documents = new Map(Object.entries(initialDocuments));
  const key = (ref) => `${ref.collectionName}/${ref.id}`;
  const ref = (collectionName, id) => ({ collectionName, id });
  const snapshot = (documentRef) => {
    const value = documents.get(key(documentRef));
    return {
      exists: value !== undefined,
      data: () => value,
      ref: documentRef,
    };
  };
  const tx = {
    get: jest.fn(async (documentRef) => snapshot(documentRef)),
    set: jest.fn((documentRef, value, options) => {
      const documentKey = key(documentRef);
      const before = documents.get(documentKey) || {};
      documents.set(documentKey, options?.merge ? { ...before, ...value } : { ...value });
    }),
  };
  const db = {
    collection: jest.fn((collectionName) => ({ doc: (id) => ref(collectionName, id) })),
    runTransaction: jest.fn(async (handler) => handler(tx)),
  };
  return {
    db,
    get: (collectionName, id) => documents.get(`${collectionName}/${id}`),
  };
}

describe('markDriverArrived safe wait projection', () => {
  it('copies only server timing metadata to the winning driver offer', async () => {
    const nowMs = 1_000_000;
    const store = createFirestore({
      [`${C.RIDE_REQUESTS}/ride-1`]: {
        rideId: 'ride-1',
        status: C.RIDE_STATUS.ASSIGNED,
        acceptedDriverId: 'driver-1',
        passengerId: 'passenger-1',
        destination: { lat: -4.1, lng: -38.4, label: 'private destination' },
      },
      [`${C.DRIVER_OFFERS}/ride-1_driver-1`]: {
        rideId: 'ride-1',
        driverId: 'driver-1',
        status: C.OFFER_STATUS.ACCEPTED,
        driverRideStatus: C.RIDE_STATUS.ASSIGNED,
      },
    });

    const result = await markDriverArrived({
      db: store.db,
      request: {
        auth: { uid: 'driver-1' },
        data: {
          rideId: 'ride-1',
          idempotencyKey: 'arrival-test-key-0001',
        },
      },
      context: { traceId: 'trace-arrival' },
      clock: { now: () => nowMs },
    });

    expect(result).toEqual({
      rideId: 'ride-1',
      status: C.RIDE_STATUS.DRIVER_ARRIVED,
      driverArrivedAtMs: nowMs,
      passengerNoShowEligibleAtMs: nowMs + PASSENGER_NO_SHOW_WAIT_MS,
      replay: false,
    });

    const ride = store.get(C.RIDE_REQUESTS, 'ride-1');
    expect(ride).toMatchObject({
      status: C.RIDE_STATUS.DRIVER_ARRIVED,
      driverArrivedAtMs: nowMs,
      passengerNoShowEligibleAtMs: nowMs + PASSENGER_NO_SHOW_WAIT_MS,
    });

    const offer = store.get(C.DRIVER_OFFERS, 'ride-1_driver-1');
    expect(offer).toMatchObject({
      driverRideStatus: C.RIDE_STATUS.DRIVER_ARRIVED,
      driverArrivedAtMs: nowMs,
      passengerNoShowEligibleAtMs: nowMs + PASSENGER_NO_SHOW_WAIT_MS,
      passengerNoShowWaitMs: PASSENGER_NO_SHOW_WAIT_MS,
    });
    expect(offer).not.toHaveProperty('destination');
    expect(offer).not.toHaveProperty('passengerId');
    expect(offer).not.toHaveProperty('passengerName');

    expect(store.get(C.NOTIFICATION_EVENTS, 'ride-1_ride_arrived_passenger')).toMatchObject({
      eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
      rideId: 'ride-1',
      recipientRole: 'passenger',
      status: C.NOTIFICATION_STATUS.PENDING,
    });
  });
});