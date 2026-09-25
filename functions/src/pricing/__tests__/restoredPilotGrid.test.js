'use strict';

const { priceRide, isPeak, getVehiclePricing, PEAK } = require('../pricing');

// Fixed local time in Horizonte (UTC-3).
const atLocalHour = (hour) => Date.UTC(2026, 8, 25, hour + 3, 0, 0);

describe('restored Horizonte pilot fare grid', () => {
  it('prices short and long routes with the same V1.3 kilometre and minute rates', () => {
    expect(priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15 }))
      .toMatchObject({ passengerFareCentavos: 775, commissionCentavos: 93 });
    expect(priceRide({ vehicleType: 'car', distanceKm: 5, durationMin: 15 }))
      .toMatchObject({ passengerFareCentavos: 1125, commissionCentavos: 169 });

    const moto5 = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15 });
    const moto15 = priceRide({ vehicleType: 'moto', distanceKm: 15, durationMin: 15 });
    const car5 = priceRide({ vehicleType: 'car', distanceKm: 5, durationMin: 15 });
    const car15 = priceRide({ vehicleType: 'car', distanceKm: 15, durationMin: 15 });
    expect(moto15.passengerFareCentavos - moto5.passengerFareCentavos).toBe(10 * 85);
    expect(car15.passengerFareCentavos - car5.passengerFareCentavos).toBe(10 * 120);
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'moto').longRidePerKmCentavos).toBeUndefined();
    expect(getVehiclePricing('HORIZONTE_CE_BR', 'car').longRidePerKmCentavos).toBeUndefined();
  });

  it('charges the same fare all day, including the former evening peak window', () => {
    expect(PEAK.enabled).toBe(false);
    const regular = priceRide({ vehicleType: 'car', distanceKm: 10, durationMin: 25, atMs: atLocalHour(14) });
    for (const hour of [0, 17, 18, 19, 21, 22]) {
      const fare = priceRide({ vehicleType: 'car', distanceKm: 10, durationMin: 25, atMs: atLocalHour(hour) });
      expect(fare.passengerFareCentavos).toBe(regular.passengerFareCentavos);
      expect(fare).toMatchObject({ peakApplied: false, peakSurchargeCentavos: 0, peakMultiplierBps: 10000 });
      expect(isPeak(atLocalHour(hour))).toBe(false);
    }
  });

  it('keeps the approved minimum fares and rejects impossible route inputs', () => {
    expect(priceRide({ vehicleType: 'moto', distanceKm: 0.5, durationMin: 3 }).passengerFareCentavos).toBe(500);
    expect(priceRide({ vehicleType: 'car', distanceKm: 0.5, durationMin: 3 }).passengerFareCentavos).toBe(750);
    expect(priceRide({ vehicleType: 'moto', distanceKm: -1, durationMin: 5 }).ok).toBe(false);
    expect(priceRide({ vehicleType: 'bike', distanceKm: 2, durationMin: 5 }).ok).toBe(false);
  });
});
