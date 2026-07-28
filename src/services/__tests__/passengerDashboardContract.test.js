const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('authenticated passenger dashboard and history contract', () => {
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

  it('separates the account dashboard from the secure ride request flow', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');
    const rideCta = source('src/components/PassengerRideRequestCta.jsx');
    const request = source('src/app/(passenger)/request-ride.jsx');
    const locationAction = source('src/components/LocationActionButton.jsx');

    expect(home).toContain('Olá, ${firstName} 👋');
    expect(home).toContain('Pronto para sua próxima corrida?');
    expect(home).toContain('<PassengerRideRequestCta');
    expect(rideCta).toContain('Pedir corrida');
    expect(home).toContain("router.push('/request-ride')");
    expect(home).not.toContain('resolveAddressToCoords');
    expect(home).not.toContain('requestRide({');

    expect(request).toContain('<LocationActionButton');
    expect(locationAction).toContain('Usar minha localização atual');
    expect(request).toContain('getCurrentLocationWithAddress');
    expect(request).toContain('resolveAddressToCoords');
    expect(request).toContain('requestRide({');
    expect(request).toContain("pathname: '/searching'");
  });

  it('provides account, history, legal links and safe sign-out', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');
    const profile = source('src/app/(passenger)/passenger-profile.jsx');
    const runtimeLinks = source('src/config/publicPolicyLinks.js');
    const legalUrls = source('src/constants/legalUrls.js');

    expect(home).toContain('MINHA CONTA');
    expect(home).toContain('Meus dados');
    expect(home).toContain("navigate('/passenger-profile', 'open_profile')");
    expect(home).toContain('Histórico de corridas');
    expect(home).toContain("navigate('/passenger-ride-history', 'open_history')");
    expect(home).toContain('AJUDA E INFORMAÇÕES');
    expect(home).toContain("params: { source: 'passenger_home' }");
    expect(home).toContain('Política de Privacidade');
    expect(home).toContain('Termos de Uso');
    expect(home).toContain('Excluir conta e dados');
    expect(home).toContain("router.push('/privacy-center')");
    expect(home).toContain('await logoutUser()');
    expect(home).toContain('SAIR DA CONTA');

    expect(profile).toContain('getPassenger(uid)');
    expect(profile).toContain('Cidade de atendimento');
    expect(profile).not.toContain('updateDoc(');
    expect(profile).not.toContain('setDoc(');

    expect(runtimeLinks).toContain('LEGAL_URLS.privacyPolicyUrl');
    expect(runtimeLinks).toContain('LEGAL_URLS.termsOfUseUrl');
    expect(runtimeLinks).toContain('LEGAL_URLS.accountDeletionWebUrl');
    expect(legalUrls).toContain('https://rize-website-steel.vercel.app/drivelocal/privacy');
    expect(legalUrls).toContain('https://rize-website-steel.vercel.app/terms');
    expect(legalUrls).toContain('https://rize-website-steel.vercel.app/drivelocal/account-deletion');
  });

  it('keeps haptic and animated feedback reusable without duplicating button logic', () => {
    const home = source('src/app/(passenger)/passenger-home.jsx');
    const button = source('src/components/AppButton.jsx');
    const rideCta = source('src/components/PassengerRideRequestCta.jsx');
    const request = source('src/app/(passenger)/request-ride.jsx');
    const locationAction = source('src/components/LocationActionButton.jsx');
    const logger = source('src/utils/clientRideLog.js');

    expect(button).toContain("import * as Haptics from 'expo-haptics'");
    expect(button).toContain('Animated.spring(scale');
    expect(button).toContain("haptic = 'light'");
    expect(button).toContain('pressScale = true');
    expect(home).toContain('haptic="medium"');
    expect(home).toContain('haptic="warning"');
    expect(rideCta).toContain('AnimatedPressable');
    expect(rideCta).toContain('Haptics.ImpactFeedbackStyle.Medium');
    expect(request).toContain('<AppButton');
    expect(request).toContain('<LocationActionButton');
    expect(locationAction).toContain('Usar minha localização atual');
    expect(locationAction).toContain('AnimatedPressable');
    expect(locationAction).toContain('Haptics.ImpactFeedbackStyle.Medium');
    expect(locationAction).toContain('Haptics.NotificationFeedbackType.Success');
    expect(logger).toContain('route: safeString(fields.route, 96)');
  });

  it('loads the paginated full history from the authenticated backend service', () => {
    const screen = source('src/app/(passenger)/passenger-ride-history.jsx');
    const service = source('src/services/passengerRideHistoryService.js');
    const row = source('src/components/PassengerRideHistoryRow.jsx');

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
