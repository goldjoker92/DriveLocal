const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('passenger quoted ride flow contracts', () => {
  it('creates rides only through the secure callable and continues to searching', () => {
    const requestScreen = source('src/app/(passenger)/request-ride.jsx');

    expect(requestScreen).toContain("import { requestRide } from '../../services/ridesService'");
    expect(requestScreen).toContain('resolveAddressToCoords');
    expect(requestScreen).toContain("pathname: '/searching'");
    expect(requestScreen).toContain('estimatedFareCentavos');
    expect(requestScreen).toContain('routeDistanceMeters');
    expect(requestScreen).toContain('routeDurationSeconds');
    expect(requestScreen).not.toContain("from '../../services/rideRequestService'");
    expect(requestScreen).not.toContain("router.replace('/(passenger)/passenger-home')");
  });

  it('shows the server quote during dispatch and never renders the old placeholder map', () => {
    const searching = source('src/app/(passenger)/searching.jsx');
    const passengerHome = source('src/app/(passenger)/passenger-home.jsx');

    expect(searching).toContain('Resumo da corrida');
    expect(searching).toContain('Preço estimado');
    expect(searching).toContain('formatBRL');
    expect(searching).toContain('formatDistanceKm');
    expect(searching).toContain('formatDurationMinutes');
    expect(searching).toContain('listenToRide');
    expect(passengerHome).not.toContain('MapPlaceholder');
    expect(passengerHome).not.toContain('Sua localização (placeholder)');
  });

  it('emits structured client logs without logging exact ride coordinates', () => {
    const ridesService = source('src/services/ridesService.js');
    const clientLog = source('src/utils/clientRideLog.js');

    expect(ridesService).toContain('ride.request.callable_started');
    expect(ridesService).toContain('ride.snapshot.received');
    expect(clientLog).toContain('[DriveLocal][RIDE_CLIENT]');
    expect(clientLog).toContain('pickupLabelPresent');
    expect(clientLog).toContain('destinationLabelPresent');
    expect(clientLog).not.toContain('pickup: ride.pickup');
    expect(clientLog).not.toContain('destination: ride.destination');
  });
});
