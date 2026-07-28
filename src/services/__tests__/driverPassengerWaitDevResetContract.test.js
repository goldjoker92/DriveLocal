const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver passenger wait compact contract', () => {
  test('keeps the global waiting status compact and moves long copy into details', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');

    expect(guard).toContain('Chegada registrada ·');
    expect(guard).toContain('Ausência disponível em');
    expect(guard).toContain('DETALHES');
    expect(guard).toContain('visible={detailsOpen}');
    expect(guard).toContain('A corrida continua disponível na tela principal enquanto você aguarda.');
    expect(guard).toContain('style={styles.summaryRow}');
    expect(guard).not.toContain('style={styles.copy}');
  });

  test('offers an explicit restart only when the DEV simulator is enabled', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');
    const runtime = source('src/config/runtimeEnvironment.js');

    expect(guard).toContain("DEV_RIDE_SIMULATOR_ENABLED ? '🧪 MODO DE TESTE' : 'PASSAGEIRO AVISADO'");
    expect(guard).toContain('RECOMEÇAR O TESTE');
    expect(guard).toContain('{DEV_RIDE_SIMULATOR_ENABLED ? (');
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
    expect(guard).toContain('driverArrivalConfirmationCopy(offer)');
  });
});