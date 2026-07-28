const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver passenger wait DEV reset contract', () => {
  test('offers a compact explicit restart only when the DEV simulator is enabled', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');
    const runtime = source('src/config/runtimeEnvironment.js');

    expect(guard).toContain('if (DEV_RIDE_SIMULATOR_ENABLED)');
    expect(guard).toContain('RECOMEÇAR O TESTE');
    expect(guard).toContain('Motorista chegou · aguardando');
    expect(runtime).toContain("APP_ENVIRONMENT === 'development'");
    expect(runtime).toContain('extra.devRideSimulatorEnabled === true');
  });

  test('cancels the test ride, cleans simulated tracking and returns to driver home', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');

    expect(guard).toContain("cancelRide(activeRideId, 'driver_other', 'driver')");
    expect(guard).toContain('stopDevRideSimulation({ restoreRealTracking: false })');
    expect(guard).toContain('detachActiveRideTracking(activeRideId)');
    expect(guard).toContain("router.replace('/driver-home')");
    expect(guard).toContain('dev_test_reset.succeeded');
  });

  test('keeps the production no-show timer and server-enforced action unchanged', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');

    expect(guard).toContain('noShowRemainingMs(driverArrivedAtMs, nowMs)');
    expect(guard).toContain('reportPassengerNotFound(activeRideId)');
    expect(guard).toContain('disabled={busy || !noShowAvailable}');
    expect(guard).toContain('PASSAGEIRO NÃO APARECEU');
  });
});
