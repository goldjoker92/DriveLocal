jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

const C = require('../../rides/constants');
const {
  buildMulticastMessage,
  presentationForEvent,
  processRideNotificationEvent,
} = require('../processEvent');

function arrivedEvent(overrides = {}) {
  return {
    notificationId: 'ride-1_ride_arrived_passenger',
    eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
    rideId: 'ride-1',
    offerId: null,
    recipientUid: 'passenger-1',
    recipientRole: 'passenger',
    route: '/driver-accepted',
    traceId: 'trace-arrived',
    status: C.NOTIFICATION_STATUS.PENDING,
    attemptCount: 0,
    ...overrides,
  };
}

describe('driver arrived passenger notification', () => {
  it('uses the exact passenger-facing arrival copy', () => {
    expect(presentationForEvent(arrivedEvent())).toEqual({
      title: '🚗 Seu motorista chegou!',
      body: 'Ele está esperando no local de embarque.',
    });
  });

  it('uses the dedicated strong Android arrival channel and safe route data', () => {
    const message = buildMulticastMessage(arrivedEvent(), ['token-1']);

    expect(message).toMatchObject({
      tokens: ['token-1'],
      notification: {
        title: '🚗 Seu motorista chegou!',
        body: 'Ele está esperando no local de embarque.',
      },
      data: {
        notificationId: 'ride-1_ride_arrived_passenger',
        eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
        rideId: 'ride-1',
        recipientRole: 'passenger',
        route: '/driver-accepted',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: C.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL,
          sound: C.NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
          defaultVibrateTimings: false,
          vibrateTimingsMillis: [...C.DRIVER_ARRIVAL_VIBRATION_PATTERN],
          priority: 'max',
          visibility: 'public',
        },
      },
    });
    expect(JSON.stringify(message)).not.toMatch(/address|cpf|phone|pixKey|wallet/i);
  });

  it('records no_active_tokens without throwing or invoking the provider', async () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({ forEach: () => undefined })),
    };
    const db = { collection: jest.fn(() => query) };
    const eventRef = { set: jest.fn(async () => undefined) };
    const messaging = { sendEachForMulticast: jest.fn() };

    const result = await processRideNotificationEvent({
      db,
      messaging,
      eventRef,
      event: arrivedEvent(),
      context: { traceId: 'trace-no-token' },
      clock: { now: () => 1_000_000 },
    });

    expect(result).toEqual({
      status: C.NOTIFICATION_STATUS.FAILED,
      successCount: 0,
      failureCount: 0,
    });
    expect(eventRef.set).toHaveBeenCalledWith({
      status: C.NOTIFICATION_STATUS.FAILED,
      failureReason: 'no_active_tokens',
      processedAtMs: 1_000_000,
      attemptCount: 1,
    }, { merge: true });
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('ignores a redelivery after the event has already been processed', async () => {
    const db = { collection: jest.fn() };
    const messaging = { sendEachForMulticast: jest.fn() };
    const eventRef = { set: jest.fn() };

    const result = await processRideNotificationEvent({
      db,
      messaging,
      eventRef,
      event: arrivedEvent({ status: C.NOTIFICATION_STATUS.SENT }),
      context: { traceId: 'trace-redelivery' },
      clock: { now: () => 1_000_000 },
    });

    expect(result).toEqual({ skipped: true });
    expect(db.collection).not.toHaveBeenCalled();
    expect(messaging.sendEachForMulticast).not.toHaveBeenCalled();
    expect(eventRef.set).not.toHaveBeenCalled();
  });
});
