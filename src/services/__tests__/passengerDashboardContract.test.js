const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('real passenger dashboard and history contract', () => {
  it('keeps the active ride server-driven and visually prioritary', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');
    const activeCard = source('src/components/PassengerActiveRideDashboardCard.jsx');
    const passengerService = source('src/services/passengerService.js');

    expect(home).toContain('listenToPassenger(');
    expect(home).toContain('listenToRide(');
    expect(home).toContain('listenToRideLocation(');
    expect(home).toContain('activeRideId ? (');
    expect(home).toContain('PassengerActiveRideDashboardCard');
    expect(passengerService).toContain('includeMetadataChanges: true');
    expect(activeCard).toContain('MOTORISTA A CAMINHO');
    expect(activeCard).toContain('CHEGADA ESTIMADA');
    expect(activeCard).toContain('RideTrackingMap');
    expect(activeCard).toContain('LOCAL DE PARTIDA');
    expect(activeCard).toContain('DESTINO');
    expect(activeCard).toContain('PIX DIRETO');
    expect(activeCard).toContain('vehiclePlate');
  });

  it('renders stale terminal recovery states without unsafe navigation actions', () => {
    const activeCard = source('src/components/PassengerActiveRideDashboardCard.jsx');
    const home = source('src/app/(passenger)/passenger-home.jsx');

    expect(activeCard).toContain('CORRIDA CONCLUÍDA');
    expect(activeCard).toContain('VER COMPROVANTE');
    expect(activeCard).toContain('CORRIDA CANCELADA');
    expect(activeCard).toContain('action: null');
    expect(activeCard).toContain('copy.action ?');
    expect(home).toContain("pathname: '/ride-completed'");
  });

  it('submits the compact request with the chosen vehicle through the secure callable service', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');

    expect(home).toContain('Olá 👋');
    expect(home).toContain('Para onde vamos?');
    expect(home).toContain('📍 Local de partida');
    expect(home).toContain('🏁 Para onde?');
    expect(home).toContain('VEHICLE_TYPES.map');
    expect(home).toContain('resolveAddressToCoords');
    expect(home).toContain('requestRide({');
    expect(home).toContain('vehicleType,');
    expect(home).toContain('idempotencyKeyRef');
    expect(home).toContain("pathname: '/searching'");
    expect(home).not.toContain("router.push('/request-ride')");
    expect(home).not.toContain('estimatedFareCentavos: 1000');
  });

  it('loads three recent rides and a paginated full history from the secure service', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');
    const screen = source('src/app/(passenger)/passenger-ride-history.jsx');
    const service = source('src/services/passengerRideHistoryService.js');
    const row = source('src/components/PassengerRideHistoryRow.jsx');

    expect(home).toContain('loadPassengerRideHistoryPage({ limit: 3 })');
    expect(home).toContain('ÚLTIMAS 3 CORRIDAS');
    expect(home).toContain('VER TODAS');
    expect(home).toContain("router.push('/passenger-ride-history')");
    expect(screen).toContain('loadPassengerRideHistoryPage({ limit: 20 })');
    expect(screen).toContain('CARREGAR MAIS CORRIDAS');
    expect(row).toContain('item.driverFirstName');
    expect(row).toContain('item.pickupLabel');
    expect(row).toContain('item.destinationLabel');
    expect(row).toContain('item.vehicleLabel');
    expect(row).toContain('item.amountLabel');
    expect(row).toContain('item.rideStatusLabel');
    expect(row).toContain('item.pixStatusLabel');
    expect(service).toContain("httpsCallable(functions, 'getPassengerRideHistorySecure')");
    expect(service).not.toContain("collection(db, 'rideRequests'");
    expect(screen).not.toContain("collection(db, 'rideRequests'");
  });

  it('exports a closed authenticated backend history and its required index', () => {
    const index = source('functions/src/index.js');
    const callables = source('functions/src/rides/callables.js');
    const history = source('functions/src/rides/passengerHistory.js');
    const indexes = source('backend/firebase/indexes/firestore.indexes.json');

    expect(index).toContain('exports.getPassengerRideHistorySecure');
    expect(callables).toContain("bindLifecycle('getPassengerRideHistorySecure', getPassengerRideHistory)");
    expect(history).toContain("where('passengerId', '==', passengerId)");
    expect(history).toContain("orderBy('createdAtMs', 'desc')");
    expect(history).toContain('limit(limit + 1)');
    expect(history).toContain('acceptedDriverPublic?.name');
    expect(history).not.toContain('acceptedDriverId:');
    expect(history).not.toContain('paymentPixPayload:');
    expect(history).not.toContain('driverPixKey:');
    expect(history).not.toContain('commissionCapturedCentavos:');
    expect(indexes).toContain('"fieldPath": "passengerId"');
    expect(indexes).toContain('"fieldPath": "createdAtMs", "order": "DESCENDING"');
  });
});