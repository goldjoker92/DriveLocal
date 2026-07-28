'use strict';

const {
  priceRide,
  getVehiclePricing,
  PRICING_CONFIG_VERSION,
} = require('../pricing');

describe('Horizonte profitable minimum commission policy', () => {
  it('charges R$1.00 on the minimum moto ride', () => {
    const result = priceRide({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'moto',
      distanceKm: 0,
      durationMin: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      pricingConfigVersion: 'horizonte-1.2.0',
      passengerFareCentavos: 600,
      commissionCentavos: 100,
      minimumPlatformCommissionCentavos: 100,
      driverNetCentavos: 500,
      commissionBps: 1200,
    });
  });

  it('charges R$1.43 on the minimum car ride', () => {
    const result = priceRide({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'car',
      distanceKm: 0,
      durationMin: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      pricingConfigVersion: 'horizonte-1.2.0',
      passengerFareCentavos: 950,
      commissionCentavos: 143,
      minimumPlatformCommissionCentavos: 143,
      driverNetCentavos: 807,
      commissionBps: 1500,
    });
  });

  it('uses the normal percentage when it exceeds the minimum', () => {
    expect(priceRide({
      vehicleType: 'moto',
      distanceKm: 5,
      durationMin: 15,
    })).toMatchObject({
      passengerFareCentavos: 905,
      commissionCentavos: 109,
      driverNetCentavos: 796,
    });

    expect(priceRide({
      vehicleType: 'car',
      distanceKm: 5,
      durationMin: 15,
    })).toMatchObject({
      passengerFareCentavos: 1325,
      commissionCentavos: 199,
      driverNetCentavos: 1126,
    });
  });

  it('keeps every sampled standard ride above the platform and driver minimums', () => {
    for (const distanceKm of [0, 1, 3, 5, 10, 15]) {
      const durationMin = distanceKm * 2;
      const moto = priceRide({ vehicleType: 'moto', distanceKm, durationMin });
      const car = priceRide({ vehicleType: 'car', distanceKm, durationMin });

      expect(moto.ok).toBe(true);
      expect(moto.commissionCentavos).toBeGreaterThanOrEqual(100);
      expect(moto.driverNetCentavos).toBeGreaterThanOrEqual(500);

      expect(car.ok).toBe(true);
      expect(car.commissionCentavos).toBeGreaterThanOrEqual(143);
      expect(car.driverNetCentavos).toBeGreaterThanOrEqual(800);
    }
  });

  it('publishes the versioned configuration values used by both quote and acceptance', () => {
    expect(PRICING_CONFIG_VERSION).toBe('horizonte-1.2.0');
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'moto')).toMatchObject({
      minimumPassengerFareCentavos: 600,
      minimumPlatformCommissionCentavos: 100,
      minimumDriverNetCentavos: 500,
    });
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'car')).toMatchObject({
      minimumPassengerFareCentavos: 950,
      minimumPlatformCommissionCentavos: 143,
      minimumDriverNetCentavos: 800,
    });
  });
});