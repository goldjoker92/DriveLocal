const fs = require('fs');
const path = require('path');
const {
  acceptanceRatePercent,
  calculateOfferCommission,
  deriveRideOfferPresentation,
  estimatePickupMinutes,
} = require('../rideOfferPresentation');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 24, 12, 0, 0);

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver ride-offer presentation', () => {
  it('keeps #101+ commission-free while counting down the five rides before the plan', () => {
    const view = deriveRideOfferPresentation({
      founderEligible: false,
      vehicleType: 'moto',
      commissionFreeUntil: NOW + 30 * DAY_MS,
      freeRideCountUsed: 2,
      walletAvailableCentavos: 0,
    }, {
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
      estimatedFareCentavos: 823,
      distanceToPickupMeters: 950,
    }, NOW);

    expect(view.commissionFree).toBe(true);
    expect(view.commissionPercentLabel).toBe('0%');
    expect(view.driverNetCentavos).toBe(823);
    expect(view.freeRidesRemaining).toBe(3);
    expect(view.planCentavos).toBe(990);
    expect(view.walletLow).toBe(false);
    expect(view.pickupEtaMinutes).toBe(3);
  });

  it('uses the real car and moto rates after the commission-free window', () => {
    const car = calculateOfferCommission({
      fareCentavos: 1325,
      vehicleType: 'car',
      serviceAreaId: 'HORIZONTE_CE_BR',
      commissionFree: false,
    });
    const moto = calculateOfferCommission({
      fareCentavos: 774,
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
      commissionFree: false,
    });

    expect(car.commissionPercentLabel).toBe('15%');
    expect(car.commissionCentavos).toBe(199);
    expect(moto.commissionPercentLabel).toBe('12%');
    expect(moto.commissionCentavos).toBe(93);
  });

  it('shows the actual zero charge when the minimum driver guarantee caps commission', () => {
    const minimumMoto = calculateOfferCommission({
      fareCentavos: 500,
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
      commissionFree: false,
    });

    expect(minimumMoto.commissionCentavos).toBe(0);
    expect(minimumMoto.commissionPercentLabel).toBe('0%');
    expect(minimumMoto.minimumGuaranteeApplied).toBe(true);
  });

  it('derives acceptance rate only from real fields or counters', () => {
    expect(acceptanceRatePercent({ acceptanceRate: 0.94 })).toBe(94);
    expect(acceptanceRatePercent({ offerCountReceived: 20, offerCountAccepted: 17 })).toBe(85);
    expect(acceptanceRatePercent({})).toBeNull();
  });

  it('treats a driver already at the pickup as immediate', () => {
    expect(estimatePickupMinutes(0, 'moto')).toBe(0);
    expect(estimatePickupMinutes(80, 'car')).toBe(0);
  });

  it('keeps the offer flow traceable and the destination private', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');
    const button = source('src/components/AnimatedAcceptRideButton.jsx');

    expect(screen).toContain('Tempo até embarque');
    expect(screen).toContain('Pix direto ao motorista');
    expect(screen).toContain('Promo Fundador');
    expect(screen).toContain('corridas restantes');
    expect(screen).toContain('Débito nesta corrida: R$ 0,00');
    expect(screen).toContain('Taxa de aceitação');
    expect(screen).toContain('ride.offer.accept_button_pressed');
    expect(screen).not.toContain('offer.destination');

    expect(button).toContain('Animated.loop');
    expect(button).toContain('Haptics.impactAsync');
    expect(button).toContain("loading ? 'Aceitando…' : 'Aceitar corrida'");
  });
});
