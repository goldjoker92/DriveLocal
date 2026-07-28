import {
  DRIVER_TIMED_OFFER_URGENT_SECONDS,
  DRIVER_TIMED_OFFER_VERSION,
  deriveDriverTimedOffer,
  timedOfferVehicle,
} from '../driverTimedOffer';

function offered(overrides = {}) {
  return {
    offerId: 'offer-17',
    rideId: 'ride-17',
    status: 'offered',
    vehicleType: 'moto',
    estimatedFareCentavos: 826,
    distanceToPickupMeters: 800,
    pickupPreview: { label: 'Centro' },
    ...overrides,
  };
}

describe('compact timed driver offer', () => {
  it('derives the decision-first content from real offer data', () => {
    expect(deriveDriverTimedOffer({
      offer: offered(),
      secondsLeft: 36,
      commissionPercentLabel: '0%',
      commissionStatus: 'ready',
    })).toMatchObject({
      version: DRIVER_TIMED_OFFER_VERSION,
      visible: true,
      secondsLeft: 36,
      urgent: false,
      vehicle: { type: 'moto', emoji: '🏍', label: 'MOTO' },
      pickupRegionLabel: 'Centro',
      distanceLabel: '0,8 km',
      etaLabel: '2 min',
      fareCentavos: 826,
      fareLabel: 'R$ 8,26',
      driverReceivesLabel: 'R$ 8,26',
      commissionLabel: '0%',
      paymentLabel: 'Pix direto',
      acceptTitle: 'ACEITAR — R$ 8,26',
    });
  });

  it('marks only the final countdown seconds as urgent', () => {
    expect(DRIVER_TIMED_OFFER_URGENT_SECONDS).toBe(5);
    expect(deriveDriverTimedOffer({ offer: offered(), secondsLeft: 6 }).urgent).toBe(false);
    expect(deriveDriverTimedOffer({ offer: offered(), secondsLeft: 5 }).urgent).toBe(true);
    expect(deriveDriverTimedOffer({ offer: offered(), secondsLeft: -3 }).secondsLeft).toBe(0);
  });

  it('never invents money, distance, ETA, vehicle or commission', () => {
    const view = deriveDriverTimedOffer({
      offer: offered({
        vehicleType: null,
        estimatedFareCentavos: null,
        distanceToPickupMeters: null,
        pickupPreview: null,
      }),
      secondsLeft: 20,
    });

    expect(view.vehicle).toEqual({ type: 'unknown', emoji: '🚘', label: 'VEÍCULO' });
    expect(view.pickupRegionLabel).toBe('Região do embarque');
    expect(view.distanceLabel).toBe('Distância carregando');
    expect(view.etaLabel).toBe('Tempo carregando');
    expect(view.fareCentavos).toBeNull();
    expect(view.fareLabel).toBe('Carregando valor…');
    expect(view.commissionLabel).toBe('Carregando…');
    expect(view.acceptTitle).toBe('ACEITAR');
  });

  it('shows a server-validation message when commercial context failed', () => {
    expect(deriveDriverTimedOffer({
      offer: offered(),
      commissionStatus: 'failed',
    }).commissionLabel).toBe('Validada ao aceitar');
  });

  it('uses closed vehicle labels', () => {
    expect(timedOfferVehicle('moto')).toEqual({ type: 'moto', emoji: '🏍', label: 'MOTO' });
    expect(timedOfferVehicle('car')).toEqual({ type: 'car', emoji: '🚗', label: 'CARRO' });
    expect(timedOfferVehicle('other')).toEqual({ type: 'unknown', emoji: '🚘', label: 'VEÍCULO' });
  });

  it('is hidden after the server changes the offer status', () => {
    expect(deriveDriverTimedOffer({ offer: offered({ status: 'accepted' }) }).visible).toBe(false);
    expect(deriveDriverTimedOffer({ offer: offered({ status: 'declined' }) }).visible).toBe(false);
  });
});
