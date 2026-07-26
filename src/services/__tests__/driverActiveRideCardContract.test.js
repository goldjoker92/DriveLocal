const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('block 15 permanent active ride card contract', () => {
  it('mounts the accepted ride projection above every driver screen', () => {
    const layout = source('src/app/(driver)/_layout.jsx');

    expect(layout).toContain("import DriverActiveRideCard from '../../components/DriverActiveRideCard'");
    expect(layout).toContain('const [activeRideId, setActiveRideId] = useState(null)');
    expect(layout).toContain('const [activeOffer, setActiveOffer] = useState(null)');
    expect(layout).toContain("if (offer.status === 'accepted')");
    expect(layout).toContain('setActiveOffer(offer)');
    expect(layout).toContain('setActiveOffer(null)');
    expect(layout).toContain('<DriverActiveRideCard');
    expect(layout).toContain('status={activeOffer.driverRideStatus}');

    const cardIndex = layout.indexOf('<DriverActiveRideCard');
    const stackIndex = layout.indexOf('<Stack screenOptions');
    expect(cardIndex).toBeGreaterThan(-1);
    expect(stackIndex).toBeGreaterThan(cardIndex);
  });

  it('restores the exact accepted offer from the authoritative driver activeRideId', () => {
    const layout = source('src/app/(driver)/_layout.jsx');
    const recovery = source('src/services/networkRecoveryPolicy.js');

    expect(layout).toContain('setActiveRideId(remote?.activeRideId || null)');
    expect(layout).toContain('restore_listener.started');
    expect(layout).toContain('restore_listener.succeeded');
    expect(layout).toContain('restore_listener.failed');
    expect(layout).toContain('offer.rideId === activeRideId');
    expect(layout).toContain('activeRideId\n    );');
    expect(recovery).toContain("'disputed'");
    expect(recovery).not.toMatch(/TERMINAL_RIDE_STATUSES[^\n]*disputed/);
  });

  it('uses only the accepted driver offer projection and real fare data', () => {
    const component = source('src/components/DriverActiveRideCard.jsx');
    const model = source('src/utils/driverActiveRideCard.js');
    const rides = source('src/services/ridesService.js');

    expect(component).toContain('deriveDriverActiveRideCard(offer, status)');
    expect(component).toContain('getAcceptedPassengerPhotoDownloadUrl');
    expect(component).toContain('CORRIDA ATIVA');
    expect(component).toContain('Valor da corrida');
    expect(model).toContain('offer?.estimatedFareCentavos');
    expect(model).toContain('offer?.exactPickup?.label');
    expect(model).toContain('offer?.exactDestination?.label');
    expect(model).toContain('offer?.acceptedPassengerPublic');
    expect(rides).toContain("data.status === 'accepted'");
    expect(rides).toContain('syncDriverRideHint(selected, rideId');
  });

  it('keeps destination private until boarding and removes the card at terminal end', () => {
    const model = source('src/utils/driverActiveRideCard.js');

    expect(model).toContain("const HIDDEN_STATUSES = new Set(['completed', 'cancelled'])");
    expect(model).toContain("'in_progress'");
    expect(model).toContain("'awaiting_payment'");
    expect(model).toContain("'payment_marked_sent'");
    expect(model).toContain("'disputed'");
    expect(model).toContain('Liberado após o embarque');
    expect(model).not.toContain('pickup.lat');
    expect(model).not.toContain('pickup.lng');
  });

  it('logs restoration without names, addresses, exact fare or photo paths', () => {
    const component = source('src/components/DriverActiveRideCard.jsx');
    const layout = source('src/app/(driver)/_layout.jsx');

    expect(component).toContain('[DRIVER_ACTIVE_RIDE] card.rendered');
    expect(component).toContain('passenger_photo.load_requested');
    expect(component).toContain('passenger_photo.load_succeeded');
    expect(component).toContain('passenger_photo.load_failed');
    expect(layout).toContain('[DRIVER_ACTIVE_RIDE] restore_listener.started');
    expect(layout).toContain('[DRIVER_ACTIVE_RIDE] restore_listener.succeeded');
    expect(layout).toContain('[DRIVER_ACTIVE_RIDE] restore_listener.failed');
    expect(component).not.toContain('passengerFirstName: card.passengerFirstName');
    expect(component).not.toContain('pickupLabel: card.pickupLabel');
    expect(component).not.toContain('destinationLabel: card.destinationLabel');
    expect(component).not.toContain('fareCentavos: card.fareCentavos');
    expect(component).not.toContain('photoStoragePath:');
  });
});
