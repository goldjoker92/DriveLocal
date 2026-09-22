'use strict';

// Grid v1.5: what the September field data forced us to change, pinned so a
// future edit cannot silently undo it.
//   - the first LONG_RIDE_FROM_KM kilometres stay cheap (neighbourhood rides);
//   - kilometres past that threshold cost more (the driver rides back empty);
//   - the driver's time is actually paid;
//   - the 18h-22h surcharge exists but ships OFF.

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
  it('ships disabled, so an evening ride costs the same as a midday one', () => {
    expect(PEAK.enabled).toBe(false);

    const midday = priceRide({ vehicleType: 'moto', distanceKm: 8, durationMin: 20, atMs: atLocalHour(14) });
    const evening = priceRide({ vehicleType: 'moto', distanceKm: 8, durationMin: 20, atMs: atLocalHour(19) });

    expect(evening.passengerFareCentavos).toBe(midday.passengerFareCentavos);
    expect(evening.peakApplied).toBe(false);
    expect(evening.peakMultiplierBps).toBe(10000);
  });

  it('never applies without a clock, whatever the switch says', () => {
    expect(isPeak(undefined)).toBe(false);
    expect(isPeak(null)).toBe(false);
    expect(isPeak(Number.NaN)).toBe(false);
  });

  it('covers 18:00-21:59 local once enabled', () => {
    const enabled = { ...PEAK, enabled: true };
    const inWindow = (hour) => {
      const h = new Date(atLocalHour(hour) - 3 * 3600 * 1000).getUTCHours();
      return h >= enabled.fromHour && h < enabled.toHour;
    };

    expect(inWindow(17)).toBe(false);
    expect(inWindow(18)).toBe(true);
    expect(inWindow(21)).toBe(true);
    expect(inWindow(22)).toBe(false);
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
