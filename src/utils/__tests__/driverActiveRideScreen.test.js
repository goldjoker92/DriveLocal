import {
  DRIVER_ACTIVE_RIDE_SCREEN_VERSION,
  deriveDriverActiveRideNavigation,
  deriveDriverActiveRidePrimaryAction,
  deriveDriverActiveRideStage,
  driverActiveRideNavigationMode,
} from '../driverActiveRideScreen';

describe('block 16 active ride screen policy', () => {
  it('exposes a versioned four-step driver hierarchy', () => {
    expect(DRIVER_ACTIVE_RIDE_SCREEN_VERSION).toBe('driver-active-ride-screen-v1');
    expect(deriveDriverActiveRideStage('assigned')).toMatchObject({
      index: 1,
      total: 4,
      label: 'A caminho do embarque',
    });
    expect(deriveDriverActiveRideStage('driver_arrived')).toMatchObject({ index: 2 });
    expect(deriveDriverActiveRideStage('in_progress')).toMatchObject({ index: 3 });
    expect(deriveDriverActiveRideStage('awaiting_payment')).toMatchObject({ index: 4 });
  });

  it.each([
    ['assigned', 'arrive', 'CHEGUEI AO LOCAL'],
    ['driver_arrived', 'start', 'PASSAGEIRO EMBARCOU'],
    ['in_progress', 'finish', 'FINALIZAR CORRIDA'],
    ['awaiting_payment', 'confirm', 'PAGAMENTO RECEBIDO'],
    ['payment_marked_sent', 'confirm', 'PAGAMENTO RECEBIDO'],
  ])('maps %s to its single primary action', (status, key, label) => {
    const action = deriveDriverActiveRidePrimaryAction({
      status,
      hasPickup: true,
      hasDestination: true,
      hasPaymentPayload: true,
    });
    expect(action).toMatchObject({ key, label, title: label, disabled: false });
  });

  it('disables only when the secure data required by the action is missing', () => {
    expect(deriveDriverActiveRidePrimaryAction({ status: 'assigned' })).toMatchObject({
      disabled: true,
      unavailableReason: 'pickup_missing',
    });
    expect(deriveDriverActiveRidePrimaryAction({ status: 'driver_arrived' }).disabled).toBe(false);
    expect(deriveDriverActiveRidePrimaryAction({ status: 'in_progress' })).toMatchObject({
      disabled: true,
      unavailableReason: 'destination_missing',
    });
    expect(deriveDriverActiveRidePrimaryAction({ status: 'awaiting_payment' })).toMatchObject({
      disabled: true,
      unavailableReason: 'paymentPayload_missing',
    });
  });

  it('keeps the current action disabled and changes its copy while pending', () => {
    expect(deriveDriverActiveRidePrimaryAction({
      status: 'in_progress',
      busy: 'finish',
      hasDestination: true,
    })).toMatchObject({
      title: 'ENVIANDO…',
      disabled: true,
      pending: true,
    });
  });

  it('navigates to pickup before boarding and destination after boarding', () => {
    const pickup = { lat: -4.1, lng: -38.4 };
    const destination = { lat: -4.2, lng: -38.5 };

    expect(deriveDriverActiveRideNavigation({ status: 'assigned', pickup, destination })).toEqual({
      kind: 'pickup',
      title: 'Navegar até o embarque',
      point: pickup,
    });
    expect(deriveDriverActiveRideNavigation({ status: 'driver_arrived', pickup, destination }).point).toBe(pickup);
    expect(deriveDriverActiveRideNavigation({ status: 'in_progress', pickup, destination })).toEqual({
      kind: 'destination',
      title: 'Navegar até o destino',
      point: destination,
    });
    expect(deriveDriverActiveRideNavigation({ status: 'awaiting_payment', pickup, destination })).toBeNull();
  });

  it('uses motorcycle/two-wheeler for moto and driving/private for car', () => {
    expect(driverActiveRideNavigationMode('moto')).toEqual({
      google: 'two-wheeler',
      waze: 'motorcycle',
      label: 'Modo moto',
    });
    expect(driverActiveRideNavigationMode('car')).toEqual({
      google: 'driving',
      waze: 'private',
      label: 'Modo carro',
    });
  });
});
