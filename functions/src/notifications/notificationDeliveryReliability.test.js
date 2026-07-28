const fs = require('fs');
const path = require('path');

const {
  buildMulticastMessage,
  presentationForEvent,
} = require('./processEvent');
const C = require('../rides/constants');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('notification delivery reliability', () => {
  test('driver arrival uses a visible high-priority Android notification', () => {
    const event = {
      notificationId: 'ride-arrived-test',
      eventType: C.NOTIFICATION_EVENT.RIDE_ARRIVED,
      rideId: 'ride_123',
      recipientRole: 'passenger',
      route: '/driver-accepted',
    };

    expect(presentationForEvent(event)).toEqual({
      title: 'Motorista chegou',
      body: 'Seu motorista chegou ao local de embarque.',
    });

    const message = buildMulticastMessage(event, ['token-a']);
    expect(message.android.priority).toBe('high');
    expect(message.android.ttl).toBe(10 * 60 * 1000);
    expect(message.android.collapseKey).toContain('ride_123');
    expect(message.android.notification.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_STATUS);
    expect(message.android.notification.sound).toBe('default');
    expect(message.android.notification.defaultVibrateTimings).toBe(true);
    expect(message.android.notification.tag).toContain('ride-arrived-test');
  });

  test('Firestore notification trigger retries and rethrows provider failures', () => {
    const bindings = source('src/notifications/callables.js');

    expect(bindings).toContain('retry: true');
    expect(bindings).toContain('throw err');
    expect(bindings).toContain('processRideNotificationEvent');
  });
});
