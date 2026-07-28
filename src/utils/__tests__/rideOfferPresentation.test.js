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

function withoutLineComments(text) {
  return text.replace(/\/\/.*$/gm, '');
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
      commissionDisplayBps: 0,
      distanceToPickupMeters: 950,
    }, NOW);

    expect(view.commissionFree).toBe(true);
    expect(view.commissionPercentLabel).toBe('0%');
    expect(view.driverReceivesCentavos).toBe(823);
    expect(view.driverNetCentavos).toBe(823);
    expect(view.freeRidesRemaining).toBe(3);
    expect(view.planCentavos).toBe(990);
    expect(view.walletLow).toBe(false);
    expect(view.pickupEtaMinutes).toBe(3);
    expect(view).not.toHaveProperty('commissionCentavos');
  });

  it('uses only the safe car and moto percentage projections', () => {
    const car = calculateOfferCommission({
      fareCentavos: 1325,
      vehicleType: 'car',
      serviceAreaId: 'HORIZONTE_CE_BR',
      commissionFree: false,
      commissionDisplayBps: 1500,
    });
    const moto = calculateOfferCommission({
      fareCentavos: 774,
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
      commissionFree: false,
      commissionDisplayBps: 1200,
    });

    expect(car.commissionPercentLabel).toBe('15%');
    expect(car.driverReceivesCentavos).toBe(1325);
    expect(moto.commissionPercentLabel).toBe('12%');
    expect(moto.driverReceivesCentavos).toBe(774);
    expect(car).not.toHaveProperty('commissionCentavos');
    expect(moto).not.toHaveProperty('commissionCentavos');
  });

  it('shows zero percent when the server minimum guarantee removes the hold', () => {
    const minimumMoto = calculateOfferCommission({
      fareCentavos: 500,
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
      commissionFree: false,
      commissionDisplayBps: 0,
    });

    expect(minimumMoto.commissionPercentLabel).toBe('0%');
    expect(minimumMoto.minimumGuaranteeApplied).toBe(true);
    expect(minimumMoto.driverReceivesCentavos).toBe(500);
    expect(minimumMoto).not.toHaveProperty('commissionCentavos');
  });

  it('falls back only to the configured policy percentage for an old expiring offer', () => {
    const moto = calculateOfferCommission({
      fareCentavos: 900,
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
      commissionFree: false,
    });
    expect(moto.commissionDisplayBps).toBe(1200);
    expect(moto.commissionPercentLabel).toBe('12%');
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

  it('never displays a provisional commission before driver context is loaded', () => {
    const screen = source('src/app/(driver)/ride-request.jsx');
    const compact = source('src/utils/driverTimedOffer.js');

    expect(screen).toContain("const [driverContextStatus, setDriverContextStatus] = useState('loading')");
    expect(screen).toContain("driverContextStatus === 'ready'");
    expect(screen).toContain('KNOWN_VEHICLE_TYPES.has(offer.vehicleType)');
    expect(screen).toContain('commissionStatus: driverContextStatus');
    expect(compact).toContain("? 'Validada ao aceitar'");
    expect(compact).toContain(": 'Carregando…'");
    expect(compact).not.toContain("commissionLabel: '0%'");
  });

  it('keeps plan activation and reset independent from the approval-based commission window', () => {
    const driverService = source('src/services/driverService.js');
    const executable = withoutLineComments(driverService);

    expect(executable).not.toMatch(/activateDriverSubscription[\s\S]*commissionFreeUntil\s*:/);
    expect(executable).not.toMatch(/resetDriverSubscription[\s\S]*commissionFreeUntil\s*:/);
  });
});
