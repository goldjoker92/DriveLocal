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
      pricingConfigVersion: 'horizonte-1.5.0',
      passengerFareCentavos: 600,
      commissionCentavos: 72,
      minimumPlatformCommissionCentavos: 72,
      driverNetCentavos: 528,
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
      pricingConfigVersion: 'horizonte-1.5.0',
      passengerFareCentavos: 850,
      commissionCentavos: 128,
      minimumPlatformCommissionCentavos: 128,
      driverNetCentavos: 722,
      commissionBps: 1500,
    });
  });

  it('uses the normal percentage when it exceeds the minimum', () => {
    expect(priceRide({
      vehicleType: 'moto',
      distanceKm: 5,
      durationMin: 15,
    })).toMatchObject({
      passengerFareCentavos: 1110,
      commissionCentavos: 133,
      driverNetCentavos: 977,
    });

    expect(priceRide({
      vehicleType: 'car',
      distanceKm: 5,
      durationMin: 15,
    })).toMatchObject({
      passengerFareCentavos: 1570,
      commissionCentavos: 236,
      driverNetCentavos: 1334,
    });
  });

  it('charges commission and preserves the configured driver net on every sample', () => {
    for (const distanceKm of [0, 1, 3, 5, 10, 15]) {
      const durationMin = distanceKm * 2;
      const moto = priceRide({ vehicleType: 'moto', distanceKm, durationMin });
      const car = priceRide({ vehicleType: 'car', distanceKm, durationMin });

      expect(moto.ok).toBe(true);
      expect(moto.commissionCentavos).toBeGreaterThanOrEqual(72);
      expect(moto.driverNetCentavos).toBeGreaterThanOrEqual(528);

      expect(car.ok).toBe(true);
      expect(car.commissionCentavos).toBeGreaterThanOrEqual(128);
      expect(car.driverNetCentavos).toBeGreaterThanOrEqual(722);
    }
  });

  it('publishes the versioned configuration values used by both quote and acceptance', () => {
    expect(PRICING_CONFIG_VERSION).toBe('horizonte-1.5.0');
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'moto')).toMatchObject({
      baseFareCentavos: 250,
      perKmCentavos: 100,
      longRidePerKmCentavos: 130,
      perMinuteCentavos: 20,
      minimumPassengerFareCentavos: 600,
      minimumPlatformCommissionCentavos: 72,
      minimumDriverNetCentavos: 528,
    });
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'car')).toMatchObject({
      baseFareCentavos: 350,
      perKmCentavos: 140,
      longRidePerKmCentavos: 175,
      perMinuteCentavos: 30,
      minimumPassengerFareCentavos: 850,
      minimumPlatformCommissionCentavos: 128,
      minimumDriverNetCentavos: 722,
    });
  });
});
