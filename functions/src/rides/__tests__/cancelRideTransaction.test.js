jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

jest.mock('../../audit/auditLog', () => ({
  writeAuditLog: jest.fn(async () => 'audit-1'),
}));

jest.mock('../../risk/riskEngine', () => ({
  bestEffortRiskSignal: jest.fn(async () => ({ eventId: 'risk-1' })),
}));

const { writeAuditLog } = require('../../audit/auditLog');
const { bestEffortRiskSignal } = require('../../risk/riskEngine');
const C = require('../constants');
const { cancelRide } = require('../cancelRide');

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
    delete: jest.fn((documentRef) => documents.delete(key(documentRef))),
  };

  const db = {
    collection: jest.fn((collectionName) => ({
      doc: (id) => ref(collectionName, id),
    })),
    runTransaction: jest.fn(async (handler) => handler(tx)),
  };

  return {
    db,
    tx,
    get: (collectionName, id) => documents.get(`${collectionName}/${id}`),
    has: (collectionName, id) => documents.has(`${collectionName}/${id}`),
  };
}

describe('cancelRide financial transaction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('releases the full hold, captures zero and stores cancellation context', async () => {
    const nowMs = 1_000_000;
    const store = createFirestore({
      [`${C.RIDE_REQUESTS}/ride-1`]: {
        rideId: 'ride-1',
        status: C.RIDE_STATUS.ASSIGNED,
        passengerId: 'passenger-1',
        acceptedDriverId: 'driver-1',
        vehicleType: 'moto',
        createdAtMs: nowMs - 500_000,
        acceptedAtMs: nowMs - 300_000,
        commissionHoldCentavos: 150,
      },
      [`${C.DRIVERS}/driver-1`]: {
        walletHeldCentavos: 150,
        walletAvailableCentavos: 500,
        activeRideId: 'ride-1',
      },
      [`${C.PASSENGERS}/passenger-1`]: {
        activeRideId: 'ride-1',
      },
      [`${C.ACTIVE_RIDE_LOCATIONS}/ride-1`]: {
        rideId: 'ride-1',
      },
      [`${C.WALLET_TRANSACTIONS}/ride-1_hold`]: {
        status: 'held',
        amountCentavos: 150,
      },
    });

    const result = await cancelRide({
      db: store.db,
      request: {
        auth: { uid: 'passenger-1' },
        data: {
          rideId: 'ride-1',
          idempotencyKey: 'cancel-test-key-0001',
          reasonCode: 'driver_delayed',
        },
      },
      context: { traceId: 'trace-cancel' },
      clock: { now: () => nowMs },
    });

    expect(result).toMatchObject({
      rideId: 'ride-1',
      status: C.RIDE_STATUS.CANCELLED,
      cancelledBy: 'passenger',
      cancelReasonCode: 'driver_delayed',
      cancellationFeeCentavos: 0,
      replay: false,
    });

    expect(store.get(C.DRIVERS, 'driver-1')).toMatchObject({
      walletHeldCentavos: 0,
      walletAvailableCentavos: 650,
      activeRideId: null,
    });
    expect(store.get(C.PASSENGERS, 'passenger-1')).toMatchObject({ activeRideId: null });
    expect(store.has(C.ACTIVE_RIDE_LOCATIONS, 'ride-1')).toBe(false);

    expect(store.get(C.WALLET_TRANSACTIONS, 'ride-1_release')).toMatchObject({
      type: 'commission_hold_release',
      amountCentavos: 150,
      status: 'released',
      reasonCode: 'driver_delayed',
    });
    expect(store.get(C.WALLET_TRANSACTIONS, 'ride-1_hold')).toMatchObject({
      status: 'released',
      releasedCentavos: 150,
    });

    const ride = store.get(C.RIDE_REQUESTS, 'ride-1');
    expect(ride).toMatchObject({
      status: C.RIDE_STATUS.CANCELLED,
      cancelledBy: 'passenger',
      cancelReasonCode: 'driver_delayed',
      cancellationPriorStatus: C.RIDE_STATUS.ASSIGNED,
      cancellationStage: 'driver_en_route_to_pickup',
      cancellationElapsedSinceCreatedMs: 500_000,
      cancellationElapsedSinceAssignedMs: 300_000,
      driverHadArrived: false,
      cancellationFeeCentavos: 0,
      cancellationFeePolicyVersion: 'no-cancellation-fee-v1',
      commissionOriginalHoldCentavos: 150,
      commissionHoldCentavos: 0,
      holdReleasedCentavos: 150,
      commissionCapturedCentavos: 0,
      commissionSettlementStatus: 'released',
      cancellationNotificationStatus: C.NOTIFICATION_STATUS.PENDING,
    });

    const notificationId = 'ride-1_ride_cancelled_driver';
    expect(ride.cancellationNotificationEventId).toBe(notificationId);
    expect(store.get(C.NOTIFICATION_EVENTS, notificationId)).toMatchObject({
      eventType: C.NOTIFICATION_EVENT.RIDE_CANCELLED,
      rideId: 'ride-1',
      recipientRole: 'driver',
      status: C.NOTIFICATION_STATUS.PENDING,
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(bestEffortRiskSignal).toHaveBeenCalledTimes(1);
  });
});