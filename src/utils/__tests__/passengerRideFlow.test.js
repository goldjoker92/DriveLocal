const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('passenger quoted ride flow contracts', () => {
  it('shows a server quote before the secure confirmation and only then searches', () => {
    const requestScreen = source('src/app/(passenger)/request-ride.jsx');
    const confirmScreen = source('src/app/(passenger)/confirm-price.jsx');
    const service = source('src/services/ridesService.js');
    const rules = source('backend/firebase/rules/firestore.rules');

    expect(requestScreen).toContain('resolveAddressToCoords');
    expect(requestScreen).toContain("pathname: '/confirm-price'");
    expect(confirmScreen).toContain('getRideQuote({ vehicleType, pickup, destination })');
    expect(confirmScreen).toContain('Confirmar e buscar motorista');
    expect(confirmScreen).toContain("pathname: '/searching'");
    expect(service).toContain("httpsCallable(functions, 'getRideQuoteSecure')");
    expect(service).toContain("httpsCallable(functions, 'createRideFromQuoteSecure')");
    expect(rules).toContain('match /rideQuotes/{docId}');
    expect(rules).toMatch(/match \/rideRequests\/\{rideId\} \{[\s\S]*?allow create: if false;/);
    expect(requestScreen).not.toContain('requestRide({');
    expect(requestScreen).not.toContain("from '../../services/rideRequestService'");
    expect(requestScreen).not.toContain("from '../../utils/serviceArea'");
    expect(requestScreen).not.toContain("router.replace('/(passenger)/passenger-home')");
  });

  it('shows the server quote during dispatch and never renders the old placeholder map', () => {
    const searching = source('src/app/(passenger)/searching.jsx');
    const passengerHome = source('src/app/(passenger)/passenger-home.jsx');

    expect(searching).toContain('Resumo da corrida');
    expect(searching).toContain('Preço da corrida');
    expect(searching).toContain('formatBRL');
    expect(searching).toContain('formatDistanceKm');
    expect(searching).toContain('formatDurationMinutes');
    expect(searching).toContain('listenToRide');
    expect(passengerHome).not.toContain('MapPlaceholder');
    expect(passengerHome).not.toContain('Sua localização (placeholder)');
  });

  it('requests Android foreground permission before native geocoding', () => {
    const locationService = source('src/services/locationService.js');

    expect(locationService).toContain('ensureForegroundPermission');
    expect(locationService).toContain('Location.getForegroundPermissionsAsync');
    expect(locationService).toContain('Location.requestForegroundPermissionsAsync');
    expect(locationService).toContain('if (!granted) return { status: \'denied\' }');
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
