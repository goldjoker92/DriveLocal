'use strict';

// Grid v1.5: what the September field data forced us to change, pinned so a
// future edit cannot silently undo it.
//   - the first LONG_RIDE_FROM_KM kilometres stay cheap (neighbourhood rides);
//   - kilometres past that threshold cost more (the driver rides back empty);
//   - the driver's time is actually paid;
//   - the 18h-22h surcharge is ON (+20%), and never touches a minimum fare.

const {
  priceRide,
  isPeak,
  splitDistance,
  getVehiclePricing,
  LONG_RIDE_FROM_KM,
  PEAK,
} = require('../pricing');

// 2026-09-22, Horizonte local time (UTC-3).
const atLocalHour = (hour) => Date.UTC(2026, 8, 22, hour + 3, 0, 0);

describe('long-ride kilometres', () => {
  it('splits a distance at the threshold', () => {
    expect(splitDistance(2)).toEqual({ shortKm: 2, longKm: 0 });
    expect(splitDistance(LONG_RIDE_FROM_KM)).toEqual({ shortKm: 3, longKm: 0 });
    expect(splitDistance(7.5)).toEqual({ shortKm: 3, longKm: 4.5 });
  });

  it('bills only the surplus at the long rate', () => {
    const moto = getVehiclePricing('HORIZONTE_CE_BR', 'moto');
    const ride = priceRide({ vehicleType: 'moto', distanceKm: 6, durationMin: 0 });

    // 250 base + 3 km x 100 + 3 km x 130 = 940
    expect(ride.passengerFareCentavos).toBe(940);
    expect(ride.fareBreakdown).toMatchObject({ shortKm: 3, longKm: 3, minimumApplied: false });
    expect(moto.longRidePerKmCentavos).toBeGreaterThan(moto.perKmCentavos);
  });

  it('leaves short neighbourhood rides on the minimum fare', () => {
    const moto = priceRide({ vehicleType: 'moto', distanceKm: 1, durationMin: 4 });
    const car = priceRide({ vehicleType: 'car', distanceKm: 1, durationMin: 4 });

    expect(moto.passengerFareCentavos).toBe(600);
    expect(car.passengerFareCentavos).toBe(850);
    expect(moto.fareBreakdown.minimumApplied).toBe(true);
    expect(car.fareBreakdown.minimumApplied).toBe(true);
  });
});

describe('driver time', () => {
  it('pays the minutes of a slow ride', () => {
    const quick = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 10 });
    const slow = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 30 });

    // 20 extra minutes at R$0,20.
    expect(slow.passengerFareCentavos - quick.passengerFareCentavos).toBe(400);
    expect(slow.driverNetCentavos).toBeGreaterThan(quick.driverNetCentavos);
  });
});

describe('evening peak surcharge', () => {
  it('adds 20% between 18h and 22h, and nothing outside', () => {
    expect(PEAK.enabled).toBe(true);

    const ride = (hour) => priceRide({
      vehicleType: 'moto', distanceKm: 8, durationMin: 20, atMs: atLocalHour(hour),
    });
    const midday = ride(14);
    const evening = ride(19);

    expect(midday.peakApplied).toBe(false);
    expect(evening.peakApplied).toBe(true);
    expect(evening.peakMultiplierBps).toBe(12000);
    expect(evening.passengerFareCentavos)
      .toBe(Math.round(midday.passengerFareCentavos * 1.2));

    // Window edges: 17h59 pays plain, 22h00 pays plain again.
    expect(ride(17).peakApplied).toBe(false);
    expect(ride(18).peakApplied).toBe(true);
    expect(ride(21).peakApplied).toBe(true);
    expect(ride(22).peakApplied).toBe(false);
  });

  it('never charges the surcharge on a minimum-fare ride', () => {
    const evening = priceRide({
      vehicleType: 'moto', distanceKm: 0.5, durationMin: 3, atMs: atLocalHour(20),
    });
    expect(evening.passengerFareCentavos).toBe(600);
    expect(evening.fareBreakdown.minimumApplied).toBe(true);
  });

  it('never applies without a clock, whatever the switch says', () => {
    expect(isPeak(undefined)).toBe(false);
    expect(isPeak(null)).toBe(false);
    expect(isPeak(Number.NaN)).toBe(false);
  });

  it('exposes the window it applies to', () => {
    expect(PEAK).toMatchObject({ fromHour: 18, toHour: 22, multiplierBps: 12000 });
    expect(isPeak(atLocalHour(19))).toBe(true);
    expect(isPeak(atLocalHour(9))).toBe(false);
  });
});

describe('invariants that protect the driver', () => {
  it('keeps the guaranteed net and the minimum commission on every sample', () => {
    for (const distanceKm of [0, 0.5, 3, 6, 12.4, 25]) {
      for (const durationMin of [0, 8, 25, 60]) {
        for (const vehicleType of ['moto', 'car']) {
          const vp = getVehiclePricing('HORIZONTE_CE_BR', vehicleType);
          const ride = priceRide({ vehicleType, distanceKm, durationMin });

          expect(ride.ok).toBe(true);
          expect(ride.passengerFareCentavos).toBeGreaterThanOrEqual(vp.minimumPassengerFareCentavos);
          expect(ride.driverNetCentavos).toBeGreaterThanOrEqual(vp.minimumDriverNetCentavos);
          expect(ride.commissionCentavos).toBeGreaterThanOrEqual(vp.minimumPlatformCommissionCentavos);
          expect(ride.commissionCentavos + ride.driverNetCentavos).toBe(ride.passengerFareCentavos);
        }
      }
    }
  });

  it('still refuses impossible inputs', () => {
    expect(priceRide({ vehicleType: 'moto', distanceKm: -1, durationMin: 5 }).ok).toBe(false);
    expect(priceRide({ vehicleType: 'bike', distanceKm: 2, durationMin: 5 }).ok).toBe(false);
  });
});
