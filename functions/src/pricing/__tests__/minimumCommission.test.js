'use strict';

const {
  priceRide,
  getVehiclePricing,
  PRICING_CONFIG_VERSION,
} = require('../pricing');

describe('Horizonte competitive pilot pricing', () => {
  it('charges the advertised 12% on a minimum moto ride', () => {
    const result = priceRide({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'moto',
      distanceKm: 0,
      durationMin: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      pricingConfigVersion: 'horizonte-1.6.0',
      passengerFareCentavos: 500,
      commissionCentavos: 60,
      minimumPlatformCommissionCentavos: 60,
      driverNetCentavos: 440,
      commissionBps: 1200,
    });
  });

  it('charges the advertised 15% on a minimum car ride', () => {
    const result = priceRide({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'car',
      distanceKm: 0,
      durationMin: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      pricingConfigVersion: 'horizonte-1.6.0',
      passengerFareCentavos: 750,
      commissionCentavos: 113,
      minimumPlatformCommissionCentavos: 113,
      driverNetCentavos: 637,
      commissionBps: 1500,
    });
  });

  it('uses the normal percentage when it exceeds the minimum', () => {
    expect(priceRide({
      vehicleType: 'moto',
      distanceKm: 5,
      durationMin: 15,
    })).toMatchObject({
      passengerFareCentavos: 775,
      commissionCentavos: 93,
      driverNetCentavos: 682,
    });

    expect(priceRide({
      vehicleType: 'car',
      distanceKm: 5,
      durationMin: 15,
    })).toMatchObject({
      passengerFareCentavos: 1125,
      commissionCentavos: 169,
      driverNetCentavos: 956,
    });
  });

  it('charges commission and preserves the configured driver net on every sample', () => {
    for (const distanceKm of [0, 1, 3, 5, 10, 15]) {
      const durationMin = distanceKm * 2;
      const moto = priceRide({ vehicleType: 'moto', distanceKm, durationMin });
      const car = priceRide({ vehicleType: 'car', distanceKm, durationMin });

      expect(moto.ok).toBe(true);
      expect(moto.commissionCentavos).toBeGreaterThanOrEqual(60);
      expect(moto.driverNetCentavos).toBeGreaterThanOrEqual(440);

      expect(car.ok).toBe(true);
      expect(car.commissionCentavos).toBeGreaterThanOrEqual(113);
      expect(car.driverNetCentavos).toBeGreaterThanOrEqual(637);
    }
  });

  it('publishes the versioned configuration values used by both quote and acceptance', () => {
    expect(PRICING_CONFIG_VERSION).toBe('horizonte-1.6.0');
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'moto')).toMatchObject({
      baseFareCentavos: 200,
      perKmCentavos: 85,
      perMinuteCentavos: 10,
      minimumPassengerFareCentavos: 500,
      minimumPlatformCommissionCentavos: 60,
      minimumDriverNetCentavos: 440,
    });
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'car')).toMatchObject({
      baseFareCentavos: 300,
      perKmCentavos: 120,
      perMinuteCentavos: 15,
      minimumPassengerFareCentavos: 750,
      minimumPlatformCommissionCentavos: 113,
      minimumDriverNetCentavos: 637,
    });
  });
});
