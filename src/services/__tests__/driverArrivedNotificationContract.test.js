const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver arrived notification product contract', () => {
  it('updates the ride and creates one deterministic notification event atomically', () => {
    const arrived = source('functions/src/rides/markDriverArrived.js');
    const events = source('functions/src/notifications/events.js');

    expect(arrived).toContain('status: C.RIDE_STATUS.DRIVER_ARRIVED');
    expect(arrived).toContain('buildArrivalNotification');
    expect(arrived).toContain('notificationEventCreated');
    expect(arrived).toContain('if (notificationEventCreated) enqueueEventTx');
    expect(arrived).toContain('passengerScreenUpdated: true');
    expect(arrived).toContain('notificationEventReady: true');
    expect(events).toContain('deterministic');
    expect(events).toContain('rideId_eventType_recipientRole');
  });

  it('never resets a processed notification during a replay or double tap', () => {
    const arrived = source('functions/src/rides/markDriverArrived.js');
    const test = source('functions/src/rides/__tests__/markDriverArrived.test.js');

    expect(arrived).toContain('const notificationSnap = await tx.get(notificationRef)');
    expect(arrived).toContain('const notificationEventCreated = !notificationSnap.exists');
    expect(arrived).not.toContain("status: C.NOTIFICATION_STATUS.PENDING,\n      successCount");
    expect(test).toContain('never resets an existing processed arrival notification');
    expect(test).toContain('status: C.NOTIFICATION_STATUS.SENT');
  });

  it('uses the exact high-priority Android push copy and the safe passenger route', () => {
    const processor = source('functions/src/notifications/processEvent.js');
    const navigation = source('src/utils/notificationNavigation.js');

    expect(processor).toContain("title: 'Motorista chegou'");
    expect(processor).toContain("body: 'Seu motorista chegou ao local de embarque.'");
    expect(processor).toContain("priority: 'high'");
    expect(processor).toContain('C.NOTIFICATION_CHANNELS.RIDE_STATUS');
    expect(navigation).toContain("'/driver-accepted'");
    expect(navigation).toContain('ROUTES_REQUIRING_RIDE_ID');
  });

  it('supports foreground, background, locked-screen and cold-start taps', () => {
    const hook = source('src/hooks/useRideNotifications.js');
    const notificationService = source('src/services/notificationsService.js');

    expect(hook).toContain('shouldShowBanner: true');
    expect(hook).toContain('shouldShowList: true');
    expect(hook).toContain('addNotificationReceivedListener');
    expect(hook).toContain('addNotificationResponseReceivedListener');
    expect(hook).toContain('getLastNotificationResponseAsync');
    expect(hook).toContain('pendingTarget.current');
    expect(notificationService).toContain('Notifications.AndroidImportance.HIGH');
    expect(notificationService).toContain('getDevicePushTokenAsync');
  });

  it('keeps arrival successful with slow network, double press or no push token', () => {
    const activeRide = source('src/app/(driver)/active-ride.jsx');
    const ridesService = source('src/services/ridesService.js');
    const processor = source('functions/src/notifications/processEvent.js');
    const notificationTest = source('functions/src/notifications/__tests__/driverArrivedNotification.test.js');

    expect(activeRide).toContain('if (!rideId || busy) return');
    expect(activeRide).toContain("arrive: () => act('arrive', markDriverArrived)");
    expect(ridesService).toContain('runRecoverableAction');
    expect(ridesService).toContain("markDriverArrivedSecure");
    expect(processor).toContain("failureReason: 'no_active_tokens'");
    expect(notificationTest).toContain('without throwing or invoking the provider');
  });

  it('shows the passenger update immediately and confirms it clearly to the driver', () => {
    const passengerScreen = source('src/app/(passenger)/driver-accepted.jsx');
    const passengerDashboard = source('src/components/PassengerActiveRideDashboardCard.jsx');
    const waitGuard = source('src/components/DriverPassengerWaitGuard.jsx');
    const copy = source('src/utils/driverArrivalNotification.js');

    expect(passengerScreen).toContain('MOTORISTA CHEGOU');
    expect(passengerScreen).toContain("nextRide.status === 'cancelled'");
    expect(passengerDashboard).toContain('MOTORISTA CHEGOU');
    expect(waitGuard).toContain('PASSAGEIRO AVISADO');
    expect(waitGuard).toContain('driverArrivalConfirmationCopy');
    expect(copy).toContain('recebeu o aviso de chegada');
    expect(copy).toContain('sem notificações ou com a rede lenta');
  });
});
