import {
  DRIVER_ACTIVE_RIDE_CARD_VERSION,
  deriveDriverActiveRideCard,
  driverActiveRideVehicle,
} from '../driverActiveRideCard';

function acceptedOffer(overrides = {}) {
  return {
    rideId: 'ride-active-15',
    status: 'accepted',
    driverRideStatus: 'assigned',
    vehicleType: 'moto',
    estimatedFareCentavos: 826,
    exactPickup: { lat: -4.1, lng: -38.4, label: 'Rua João XXIII, 120' },
    acceptedPassengerPublic: {
      firstName: 'Maria Silva',
      photoStoragePath: 'publicPassengerPhotos/passenger-1/version-1.jpg',
      photoVerified: true,
    },
    ...overrides,
  };
}

describe('permanent driver active ride card', () => {
  it('shows the accepted ride with exact pickup and hidden destination before boarding', () => {
    const card = deriveDriverActiveRideCard(acceptedOffer());

    expect(card).toMatchObject({
      version: DRIVER_ACTIVE_RIDE_CARD_VERSION,
      visible: true,
      rideId: 'ride-active-15',
      status: 'assigned',
      passengerFirstName: 'Maria',
      pickupLabel: 'Rua João XXIII, 120',
      destinationReleased: false,
      destinationLabel: 'Liberado após o embarque',
      fareCentavos: 826,
      vehicle: { type: 'moto', emoji: '🏍', label: 'Moto' },
    });
  });

  it('keeps destination hidden after arrival and reveals it only once the ride starts', () => {
    const arrived = deriveDriverActiveRideCard(acceptedOffer({ driverRideStatus: 'driver_arrived' }));
    expect(arrived.destinationReleased).toBe(false);
    expect(arrived.destinationLabel).toBe('Liberado após o embarque');

    const started = deriveDriverActiveRideCard(acceptedOffer({
      driverRideStatus: 'in_progress',
      exactDestination: { lat: -4.2, lng: -38.5, label: 'Centro de Horizonte' },
    }));
    expect(started.destinationReleased).toBe(true);
    expect(started.destinationLabel).toBe('Centro de Horizonte');
  });

  it('stays visible through Pix settlement and a payment dispute', () => {
    expect(deriveDriverActiveRideCard(acceptedOffer({ driverRideStatus: 'awaiting_payment' })).visible).toBe(true);
    expect(deriveDriverActiveRideCard(acceptedOffer({ driverRideStatus: 'payment_marked_sent' })).visible).toBe(true);
    expect(deriveDriverActiveRideCard(acceptedOffer({ driverRideStatus: 'disputed' })).visible).toBe(true);
  });

  it('disappears only after completion or cancellation', () => {
    expect(deriveDriverActiveRideCard(acceptedOffer({ driverRideStatus: 'completed' })).visible).toBe(false);
    expect(deriveDriverActiveRideCard(acceptedOffer({ driverRideStatus: 'cancelled' })).visible).toBe(false);
  });

  it('never turns an unaccepted offer into an active ride', () => {
    const card = deriveDriverActiveRideCard(acceptedOffer({ status: 'offered', driverRideStatus: null }));
    expect(card.visible).toBe(false);
    expect(card.rideId).toBeNull();
  });

  it('uses closed vehicle labels and safe real-data fallbacks', () => {
    expect(driverActiveRideVehicle('moto')).toEqual({ type: 'moto', emoji: '🏍', label: 'Moto' });
    expect(driverActiveRideVehicle('car')).toEqual({ type: 'car', emoji: '🚗', label: 'Carro' });

    const card = deriveDriverActiveRideCard(acceptedOffer({
      acceptedPassengerPublic: null,
      exactPickup: null,
      estimatedFareCentavos: null,
      driverRideStatus: 'in_progress',
      exactDestination: null,
    }));
    expect(card.passengerFirstName).toBe('Passageiro');
    expect(card.pickupLabel).toBe('Local de embarque');
    expect(card.destinationLabel).toBe('Destino em carregamento…');
    expect(card.fareCentavos).toBe(0);
  });
});
