const C = require('../../rides/constants');
const {
  buildMulticastMessage,
  presentationForEvent,
  dataPayload,
} = require('../processEvent');

function event(messageCode = 'driver_at_pickup') {
  return {
    notificationId: 'notification-1',
    eventType: C.NOTIFICATION_EVENT.RIDE_QUICK_MESSAGE,
    rideId: 'ride-1',
    offerId: null,
    messageCode,
    recipientRole: 'passenger',
    route: '/driver-accepted',
    traceId: 'trace-1',
  };
}

describe('quick message notifications', () => {
  it('uses server-catalogued visible copy', () => {
    expect(presentationForEvent(event())).toEqual({
      title: 'Mensagem do motorista',
      body: 'Estou no local indicado.',
    });
    expect(presentationForEvent(event('passenger_needs_minute'))).toEqual({
      title: 'Mensagem do passageiro',
      body: 'Preciso de mais um minuto.',
    });
  });

  it('falls back to generic copy for an unknown code', () => {
    expect(presentationForEvent(event('unknown'))).toEqual({
      title: 'Mensagem da corrida',
      body: 'Abra a DriveLocal para ver a atualização.',
    });
  });

  it('keeps the FCM data payload strings-only and free of message text', () => {
    const payload = dataPayload(event());
    expect(payload).toEqual({
      notificationId: 'notification-1',
      eventType: C.NOTIFICATION_EVENT.RIDE_QUICK_MESSAGE,
      rideId: 'ride-1',
      offerId: '',
      messageCode: 'driver_at_pickup',
      recipientRole: 'passenger',
      route: '/driver-accepted',
      traceId: 'trace-1',
    });
    for (const value of Object.values(payload)) expect(typeof value).toBe('string');
    expect(payload).not.toHaveProperty('text');
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('email');
  });

  it('keeps the existing ride-status channel and Android priority', () => {
    const message = buildMulticastMessage(event(), ['token-1']);
    expect(message).toMatchObject({
      tokens: ['token-1'],
      notification: {
        title: 'Mensagem do motorista',
        body: 'Estou no local indicado.',
      },
      data: {
        messageCode: 'driver_at_pickup',
      },
      android: {
        priority: 'high',
        notification: {
          channelId: C.NOTIFICATION_CHANNELS.RIDE_STATUS,
        },
      },
    });
  });
});
