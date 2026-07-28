const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver device health integration contracts', () => {
  it('runs the strict device preflight before opening a Firebase work session', () => {
    const availability = source('src/services/driverAvailabilityService.js');
    const start = availability.slice(
      availability.indexOf('export async function startDriverWorkSession'),
      availability.indexOf('export async function stopDriverWorkSession'),
    );

    expect(start).toContain('prepareDriverDeviceForAvailability');
    expect(start).toContain("setDriverAvailabilitySecure({ availabilityStatus: 'online' })");
    expect(start.indexOf('prepareDriverDeviceForAvailability'))
      .toBeLessThan(start.indexOf("setDriverAvailabilitySecure({ availabilityStatus: 'online' })"));
    // The stable error code is created by the dedicated helper immediately above
    // startDriverWorkSession, while the guarded flow throws that helper result.
    expect(availability).toContain("error.code = 'DRIVER_DEVICE_NOT_READY'");
    expect(start).toContain('throw deviceNotReadyError(diagnostic)');
    expect(start).toContain('work_session.start_rejected');
  });

  it('mounts one persistent guard above all operational driver screens', () => {
    const layout = source('src/app/_layout.jsx');
    const guard = source('src/components/DriverDeviceHealthGuard.jsx');

    expect(layout).toContain('import DriverDeviceHealthGuard');
    expect(layout).toContain('<DriverDeviceHealthGuard route={pathname} />');
    expect(guard).toContain("path.includes('driver-home')");
    expect(guard).toContain("path.includes('active-ride')");
    expect(guard).toContain('CHECK_INTERVAL_MS = 30_000');
    expect(guard).toContain("AppState.addEventListener('change'");
  });

  it('never auto-stops the location session of an accepted active ride', () => {
    const guard = source('src/components/DriverDeviceHealthGuard.jsx');

    expect(guard).toContain('&& !session.rideId');
    expect(guard).toContain("traceGuard('active_ride_preserved'");
    expect(guard).toContain("result: 'alert_only'");
    expect(guard).toContain('stopDriverOnlineTracking');
    expect(guard.indexOf('&& !session.rideId'))
      .toBeLessThan(guard.indexOf('await stopDriverOnlineTracking()'));
  });

  it('treats the DEV Robot Driver as an authoritative tracking source only for its bound session', () => {
    const guard = source('src/components/DriverDeviceHealthGuard.jsx');
    const diagnostics = source('src/services/driverDeviceDiagnostics.js');

    expect(guard).toContain('DEV_RIDE_SIMULATOR_ENABLED');
    expect(guard).toContain('getRobotDriverState');
    expect(guard).toContain('robot.availabilitySessionId !== session.availabilitySessionId');
    expect(guard).toContain('robotRideId !== sessionRideId');
    expect(guard).toContain("candidate.code !== 'native_task_missing'");
    expect(guard).toContain("trackingSource: 'robot_simulation'");
    expect(guard).toContain("traceGuard('robot_tracking.accepted'");
    expect(guard.indexOf('applyRobotSimulationTrackingSource(snapshot, session)'))
      .toBeLessThan(guard.indexOf("snapshot.primaryIssue?.code === 'native_task_missing'"));

    // Production keeps the strict native-task requirement. The bypass lives only
    // in the DEV guard and only after matching the authenticated robot session.
    expect(diagnostics).toContain("issue('native_task_missing', 'blocking')");
  });

  it('persists only a safe notification receipt and never the FCM token', () => {
    const notifications = source('src/services/notificationsService.js');
    const safeStateStart = notifications.indexOf('const safeState = {');
    const safeStateEnd = notifications.indexOf('try {', safeStateStart);
    const safeState = notifications.slice(safeStateStart, safeStateEnd);

    expect(safeStateStart).toBeGreaterThan(-1);
    expect(safeState).not.toMatch(/\btoken\b/i);
    expect(notifications).toContain('NOTIFICATION_STATUS_KEY');
    expect(notifications).toContain('[DRIVER_NOTIFICATIONS]');
    expect(notifications).not.toContain('console.log(token');
    expect(notifications).not.toContain('console.warn(token');
  });

  it('uses the same seven-minute boundary as the server work-session lease', () => {
    const diagnostics = source('src/services/driverDeviceDiagnostics.js');
    const tracking = source('src/services/driverLocationTracking.js');

    expect(diagnostics).toContain('LOCATION_BLOCKING_AGE_MS = 7 * 60 * 1000');
    expect(diagnostics).toContain("const LAST_PUBLISH_KEY = '@drivelocal/driver-location-last-publish-v2'");
    expect(tracking).toContain("const LAST_PUBLISH_KEY = '@drivelocal/driver-location-last-publish-v2'");
    expect(diagnostics).toContain("issue('location_stale', 'blocking'");
  });
});
