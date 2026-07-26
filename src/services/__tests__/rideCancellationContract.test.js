const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('ride cancellation integration contracts', () => {
  it('keeps the existing screens compatible while requiring a reason choice', () => {
    const service = source('src/services/ridesService.js');
    expect(service).toContain("LEGACY_CANCELLATION_CODES");
    expect(service).toContain('chooseCancellationReason(actorRole)');
    expect(service).toContain("callRide('cancelRideSecure'");
    expect(service).toContain("reportPassengerNotFound");
  });

  it('mounts the passenger wait guard without rewriting active ride navigation', () => {
    const layout = source('src/app/_layout.jsx');
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');
    expect(layout).toContain('DriverPassengerWaitGuard');
    expect(layout).toContain('<DriverPassengerWaitGuard route={pathname} />');
    expect(guard).toContain("nextOffer?.driverRideStatus === 'driver_arrived'");
    expect(guard).toContain('PASSAGEIRO NÃO APARECEU');
    expect(guard).toContain('reportPassengerNotFound(activeRideId)');
  });

  it('uses only the private driver offer for wait timing', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');
    expect(guard).toContain('offer?.driverArrivedAtMs');
    expect(guard).toContain('offer?.passengerNoShowEligibleAtMs');
    expect(guard).not.toContain('listenToRide(');
    expect(guard).not.toContain("from '../services/ridesService';\nimport");
  });

  it('shows the timer and keeps the no-show action disabled until eligible', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');
    expect(guard).toContain('noShowRemainingMs(driverArrivedAtMs, nowMs)');
    expect(guard).toContain('disabled={busy || !noShowAvailable}');
    expect(guard).toContain('sem taxa automática');
  });

  it('contains only predefined cancellation options', () => {
    const prompt = source('src/services/rideCancellationPrompt.js');
    expect(prompt).toContain('DRIVER_CANCELLATION_REASONS');
    expect(prompt).toContain('PASSENGER_CANCELLATION_REASONS');
    expect(prompt).not.toContain('TextInput');
    expect(prompt).not.toContain('prompt(');
  });

  it('does not log passenger names, coordinates or addresses from the wait guard', () => {
    const guard = source('src/components/DriverPassengerWaitGuard.jsx');
    const traceStart = guard.indexOf('function traceWait');
    const traceSection = guard.slice(traceStart);
    expect(traceSection).not.toMatch(/passengerName|fullName|phone|email|cpf/i);
    expect(traceSection).not.toMatch(/\blat\b|\blng\b|coordinates/i);
  });
});