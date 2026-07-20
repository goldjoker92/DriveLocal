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
    expect(engine).toContain('attachActiveRideTracking');
    expect(tracking).toContain("doc(db, 'activeRideLocations', session.rideId)");
  });

  it('keeps native heartbeat from overwriting simulated GPS', () => {
    const layout = source('src/app/(driver)/_layout.jsx');
    const engine = source('src/services/robotDriverEngine.js');

    expect(layout).toContain('getRobotDriverState().enabled');
    expect(layout).toContain('native_heartbeat.skipped');
    expect(engine).toContain('Location.stopLocationUpdatesAsync');
    expect(engine).toContain('restoreRealDriverTrackingAfterSimulation');
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
