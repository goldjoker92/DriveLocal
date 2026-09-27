const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('passenger active ride reliability contract', () => {
  test('multiplexes ride subscribers and throttles location diagnostics without dropping positions', () => {
    const listeners = source('src/services/passengerRideLiveListeners.js');
    const screen = source('src/app/(passenger)/driver-accepted.jsx');
    const messages = source('src/components/RideQuickMessagesGuard.jsx');

    expect(listeners).toContain('const rideEntries = new Map()');
    expect(listeners).toContain('const locationEntries = new Map()');
    expect(listeners).toContain('includeMetadataChanges: true');
    expect(listeners).toContain("if (entry.lastSignature === signature) return");
    expect(listeners).toContain('LOCATION_LOG_INTERVAL_MS = 30_000');
    expect(listeners).toContain("logPolicy: 'state_or_30s'");
    expect(listeners).toContain("fanOut(entry, 'onData', location)");
    expect(screen).toContain('listenToPassengerRide as listenToRide');
    expect(screen).toContain('listenToPassengerRideLocation as listenToRideLocation');
    expect(messages).toContain('useRideConversation');
    expect(source('src/hooks/use-ride-conversation.js')).toContain('listenToPassengerRide');
  });

  test('shows an in-app driver-arrival alert with haptic fallback', () => {
    const screen = source('src/app/(passenger)/driver-accepted.jsx');

    expect(screen).toContain('Motorista chegou');
    expect(screen).toContain('ride.passenger.arrival_notice_presented');
    expect(screen).toContain('Haptics.NotificationFeedbackType.Success');
    expect(screen).toContain("nextRide.status === 'driver_arrived'");
    expect(screen).toContain('ARRIVAL_NOTICE_VISIBLE_MS');
  });

  test('foreground Android arrival notifications play sound and registration is deduplicated', () => {
    const notifications = source('src/hooks/useRideNotifications.js');

    expect(notifications).toContain("FOREGROUND_SOUND_EVENTS = new Set(['offer_created', 'ride_arrived'])");
    expect(notifications).toContain('shouldShowBanner: true');
    expect(notifications).toContain('shouldShowList: true');
    expect(notifications).toContain('shouldPlaySound');
    expect(notifications).toContain('registrationPromise && registrationUid === uid');
    expect(notifications).toContain('ride.notification.received');
  });

  test('map logs only semantic states and the GPS action has dedicated animated UI', () => {
    const map = source('src/components/RideTrackingMap.jsx');
    const locationButton = source('src/components/LocationActionButton.jsx');
    const requestRide = source('src/app/(passenger)/request-ride.jsx');

    expect(map).toContain('meaningfulTrackingState');
    expect(map).toContain('trackingLogStateByRide.get(rideId) === state');
    expect(map).toContain("logPolicy: 'semantic_state_only'");
    expect(locationButton).toContain('AnimatedPressable');
    expect(locationButton).toContain('Haptics.ImpactFeedbackStyle.Medium');
    expect(locationButton).toContain('Haptics.NotificationFeedbackType.Success');
    expect(locationButton).toContain('Usar minha localização atual');
    expect(requestRide).toContain('<LocationActionButton');
    expect(requestRide).toContain('loading={loadingLocation}');
    expect(requestRide).toContain('found={gpsFound}');
  });
});
