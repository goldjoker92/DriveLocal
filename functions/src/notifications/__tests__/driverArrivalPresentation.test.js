const C = require('../../rides/constants');
const {
  androidNotificationForEvent,
  buildMulticastMessage,
  presentationForEvent,
} = require('../processEvent');

function event(eventType) {
  return {
    notificationId: `notification_${eventType}`,
    eventType,
    rideId: 'ride_123',
    recipientUid: 'passenger_123',
    recipientRole: 'passenger',
    route: '/driver-accepted',
    status: C.NOTIFICATION_STATUS.PENDING,
  };
}

describe('driver arrival notification presentation', () => {
  test('uses the dedicated channel, custom sound and strong vibration only for arrival', () => {
    const arrival = event(C.NOTIFICATION_EVENT.RIDE_ARRIVED);
    const notification = androidNotificationForEvent(arrival);

    expect(notification).toEqual(expect.objectContaining({
      channelId: C.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL,
      sound: C.NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
      defaultVibrateTimings: false,
      vibrateTimingsMillis: [...C.DRIVER_ARRIVAL_VIBRATION_PATTERN],
      priority: 'max',
      visibility: 'public',
    }));
  });

  test('keeps ordinary ride updates on the existing status channel', () => {
    const assigned = event(C.NOTIFICATION_EVENT.RIDE_ASSIGNED);

    expect(androidNotificationForEvent(assigned)).toEqual(expect.objectContaining({
      channelId: C.NOTIFICATION_CHANNELS.RIDE_STATUS,
      sound: 'default',
      defaultVibrateTimings: true,
    }));
    expect(androidNotificationForEvent(assigned)).not.toHaveProperty('vibrateTimingsMillis');
  });

  test('sends an immediate high-priority, visible arrival alert without changing ride data', () => {
    const arrival = event(C.NOTIFICATION_EVENT.RIDE_ARRIVED);
    const message = buildMulticastMessage(arrival, ['token_1']);

    expect(presentationForEvent(arrival)).toEqual({
      title: '🚗 Seu motorista chegou!',
      body: 'Ele está esperando no local de embarque.',
    });
    expect(message).toEqual(expect.objectContaining({
      tokens: ['token_1'],
      android: expect.objectContaining({
        priority: 'high',
        notification: expect.objectContaining({
          channelId: C.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL,
        }),
      }),
      data: expect.objectContaining({
        eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
        rideId: 'ride_123',
        route: '/driver-accepted',
      }),
    }));
  });
});
