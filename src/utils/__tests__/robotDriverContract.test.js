const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('DEV Robot Driver contracts', () => {
  it('is development-only and never calls ride lifecycle mutations', () => {
    const engine = source('src/services/robotDriverEngine.js');
    const screen = source('src/app/(driver)/robot-driver.jsx');
    const runtime = source('src/config/runtimeEnvironment.js');

    expect(engine).toContain('DEV_RIDE_SIMULATOR_ENABLED');
    expect(screen).toContain('DEV_RIDE_SIMULATOR_ENABLED');
    expect(runtime).toContain("APP_ENVIRONMENT === 'development'");
    expect(engine).not.toContain('requestRide(');
    expect(engine).not.toContain('acceptOffer(');
    expect(engine).not.toContain('markDriverArrived(');
    expect(engine).not.toContain('startRide(');
    expect(engine).not.toContain('finishRide(');
  });

  it('publishes waiting and active-ride positions through real application documents', () => {
    const engine = source('src/services/robotDriverEngine.js');
    const tracking = source('src/services/driverLocationTracking.js');

    expect(engine).toContain("doc(db, 'drivers', state.driverId)");
    expect(engine).toContain('publishDevSimulatedLocation');
    expect(engine).toContain('TRACKING_SESSION_KEY');
    expect(engine).not.toContain('attachActiveRideTracking(');
    expect(tracking).toContain("doc(db, 'activeRideLocations', session.rideId)");
  });

  it('keeps native GPS from overwriting simulated GPS before and after going online', () => {
    const layout = source('src/app/(driver)/_layout.jsx');
    const home = source('src/app/(driver)/driver-home.jsx');
    const engine = source('src/services/robotDriverEngine.js');

    expect(layout).toContain('getRobotDriverState().enabled');
    expect(layout).toContain('native_heartbeat.skipped');
    expect(home).toContain('go_online.native_tracking_skipped');
    expect(home).toContain('online_restore.native_tracking_skipped');
    expect(home).toContain('robotSimulationActive()');
    expect(engine).toContain('Location.stopLocationUpdatesAsync');
    expect(engine).toContain('ride_bound_seed');
    expect(engine).toContain('restoreRealDriverTrackingAfterSimulation');
  });

  it('cleans stale native and robot sessions before login and logout', () => {
    const auth = source('src/services/authService.js');

    expect(auth).toContain("clearLocalDriverTracking('login_preflight')");
    expect(auth).toContain("clearLocalDriverTracking('sign_out')");
    expect(auth).toContain('await stopRobotDriver()');
    expect(auth).toContain('await stopDriverOnlineTracking()');
    expect(auth).toContain('[AUTH_TRACKING_CLEANUP]');
  });

  it('gates movement against the real ride lifecycle', () => {
    const screen = source('src/app/(driver)/robot-driver.jsx');
    const engine = source('src/services/robotDriverEngine.js');

    expect(engine).toContain("rideStatus === 'assigned'");
    expect(engine).toContain("rideStatus === 'in_progress'");
    expect(engine).toContain('ROBOT_DESTINATION_REQUIRES_IN_PROGRESS_RIDE');
    expect(engine).toContain('TERMINAL_RIDE_STATUSES');
    expect(engine).toContain('movement.blocked_by_ride_status');
    expect(screen).toContain("robot?.rideStatus === 'assigned'");
    expect(screen).toContain("robot?.rideStatus === 'in_progress'");
    expect(screen).toContain('Statut réel course');
  });

  it('provides traceable manual controls for the full successful ride observation', () => {
    const screen = source('src/app/(driver)/robot-driver.jsx');
    const engine = source('src/services/robotDriverEngine.js');

    expect(screen).toContain('Aller au pickup');
    expect(screen).toContain('Pause');
    expect(screen).toContain('Reprendre');
    expect(screen).toContain('Aller à destination');
    expect(screen).toContain('Arrêter et restaurer le GPS réel');
    expect(engine).toContain("trace('driver.snapshot'");
    expect(engine).toContain("trace('ride.snapshot'");
    expect(engine).toContain("trace('movement.tick'");
    expect(engine).toContain("trace('location.published_ride'");
  });
});
