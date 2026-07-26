const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('block 17 compact timed offer contract', () => {
  it('renders one compact decision card with the requested information hierarchy', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');
    const card = source('src/components/DriverTimedOfferCard.jsx');

    expect(screen).toContain("import DriverTimedOfferCard from '../../components/DriverTimedOfferCard'");
    expect((screen.match(/<DriverTimedOfferCard/g) || [])).toHaveLength(1);
    expect(card).toContain('view.secondsLeft');
    expect(card).toContain('VOCÊ RECEBE');
    expect(card).toContain('view.driverReceivesLabel');
    expect(card).toContain('view.distanceLabel');
    expect(card).toContain('view.etaLabel');
    expect(card).toContain('view.vehicle.label');
    expect(card).toContain('label="Comissão"');
    expect(card).toContain('label="Pagamento"');

    const countdownIndex = card.indexOf('view.secondsLeft');
    const receiveIndex = card.indexOf('VOCÊ RECEBE');
    const summaryIndex = card.indexOf('<View style={styles.summary}>');
    expect(countdownIndex).toBeGreaterThan(-1);
    expect(receiveIndex).toBeGreaterThan(countdownIndex);
    expect(summaryIndex).toBeGreaterThan(receiveIndex);
  });

  it('keeps accept and decline fixed outside the scrollable offer content', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');
    const button = source('src/components/AnimatedAcceptRideButton.jsx');

    const scrollEndIndex = screen.indexOf('</ScrollView>');
    const dockIndex = screen.indexOf('styles.actionDock');
    expect(scrollEndIndex).toBeGreaterThan(-1);
    expect(dockIndex).toBeGreaterThan(scrollEndIndex);
    expect(screen).toContain('title={compactOffer.acceptTitle}');
    expect(screen).toContain('accessibilityLabel="Recusar corrida"');
    expect(button).toContain("title = 'ACEITAR'");
    expect(button).toContain("const visibleTitle = loading ? 'ACEITANDO…' : title");
  });

  it('preserves the real countdown and server-authoritative lifecycle actions', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');
    const service = source('src/services/ridesService.js');

    expect(screen).toContain('setInterval(tick, 500)');
    expect(screen).toContain("declineOffer(offer.offerId, 'expired')");
    expect(screen).toContain('acceptOffer(offer.offerId)');
    expect(screen).toContain("declineOffer(offer.offerId, 'driver_declined')");
    expect(service).toContain("httpsCallable(functions, 'acceptDriverOfferSecure')");
    expect(service).toContain("httpsCallable(functions, 'declineDriverOfferSecure')");
  });

  it('uses only coarse pickup data before acceptance', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');
    const card = source('src/components/DriverTimedOfferCard.jsx');
    const model = source('src/utils/driverTimedOffer.js');

    expect(model).toContain('offer?.pickupPreview?.label');
    expect(model).toContain('offer?.distanceToPickupMeters');
    expect(screen).not.toContain('offer.exactPickup');
    expect(card).not.toContain('exactPickup');
    expect(card).not.toContain('exactDestination');
    expect(card).not.toContain('destination');
  });

  it('removes the old long commercial explanation cards', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');

    expect(screen).not.toContain('SEU STATUS NESTA OFERTA');
    expect(screen).not.toContain('Promo Fundador');
    expect(screen).not.toContain('Plano ativo');
    expect(screen).not.toContain('Plano em breve');
    expect(screen).not.toContain('Plano necessário');
    expect(screen).not.toContain('Saldo da carteira');
    expect(screen).not.toContain('Taxa de aceitação');
    expect(screen).not.toContain('Nenhum percentual provisório é exibido.');
  });

  it('never invents fallback money, distance, commission or vehicle data', () => {
    const model = source('src/utils/driverTimedOffer.js');
    const screen = source('src/app/(driver)/ride-request.jsx');

    expect(model).toContain("if (value == null || value === '') return null");
    expect(model).toContain('Carregando valor…');
    expect(model).toContain('Distância carregando');
    expect(model).toContain('Tempo carregando');
    expect(model).toContain('Validada ao aceitar');
    expect(model).toContain("type: 'unknown'");
    expect(screen).toContain('KNOWN_VEHICLE_TYPES.has(offer.vehicleType)');
    expect(screen).not.toContain("|| 'car'");
  });
});
