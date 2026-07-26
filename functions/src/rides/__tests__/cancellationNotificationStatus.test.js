jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  },
}));

jest.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: jest.fn((_options, handler) => handler),
}));

jest.mock('../../logging/logger', () => ({
  createLoggerContext: jest.fn(() => ({ traceId: 'trace-test' })),
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

const C = require('../constants');
const {
  cancellationDeliveryUpdate,
} = require('../cancellationNotificationStatus');

describe('cancellation notification delivery projection', () => {
  it('ignores non-cancellation notification events', () => {
    expect(cancellationDeliveryUpdate({}, {
      eventType: C.NOTIFICATION_EVENT.RIDE_STARTED,
      rideId: 'ride-1',
      status: C.NOTIFICATION_STATUS.SENT,
    }, 'notification-1')).toBeNull();
  });

  it('ignores a write that does not change status or attempts', () => {
    expect(cancellationDeliveryUpdate({
      status: C.NOTIFICATION_STATUS.PENDING,
      attemptCount: 1,
    }, {
      eventType: C.NOTIFICATION_EVENT.RIDE_CANCELLED,
      rideId: 'ride-1',
      status: C.NOTIFICATION_STATUS.PENDING,
      attemptCount: 1,
    }, 'notification-1')).toBeNull();
  });

  it('returns only support-safe delivery metadata', () => {
    const update = cancellationDeliveryUpdate({
      status: C.NOTIFICATION_STATUS.PENDING,
      attemptCount: 0,
    }, {
      eventType: C.NOTIFICATION_EVENT.RIDE_CANCELLED,
      rideId: 'ride-1',
      recipientUid: 'must-not-be-projected',
      status: C.NOTIFICATION_STATUS.SENT,
      attemptCount: 1,
      sentAtMs: 12345,
    }, 'ride-1_ride_cancelled_passenger');

    expect(update).toEqual({
      rideId: 'ride-1',
      notificationId: 'ride-1_ride_cancelled_passenger',
      status: C.NOTIFICATION_STATUS.SENT,
      attemptCount: 1,
      updatedAtMs: 12345,
    });
    expect(update).not.toHaveProperty('recipientUid');
  });
});