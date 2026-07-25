// @ts-check

const { buildSupplySnapshot, hourSnapshotId } = require('../risk/supplySnapshots');
const {
  aggregateSupplySnapshots,
  buildDemandSupply,
} = require('../risk/analytics');

const AT_18H = Date.parse('2026-08-08T21:10:00.000Z'); // 18:10 Fortaleza

describe('hourly driver supply analytics', () => {
  it('counts online, available and busy moto/car drivers without ids', () => {
    const result = buildSupplySnapshot([
      { vehicleType: 'moto', verificationStatus: 'approved', availabilityStatus: 'online', activeRideId: null },
      { vehicleType: 'moto', verificationStatus: 'approved', availabilityStatus: 'online', activeRideId: 'r1' },
      { vehicleType: 'car', verificationStatus: 'approved', availabilityStatus: 'online', activeRideId: null },
      { vehicleType: 'car', verificationStatus: 'approved', availabilityStatus: 'offline', activeRideId: null },
      { vehicleType: 'car', verificationStatus: 'approved', availabilityStatus: 'online', isBlocked: true },
    ], AT_18H);

    expect(result.online).toEqual({ moto: 2, car: 1, total: 3 });
    expect(result.available).toEqual({ moto: 1, car: 1, total: 2 });
    expect(result.busy).toEqual({ moto: 1, car: 0, total: 1 });
    expect(result.approved).toEqual({ moto: 2, car: 2, total: 4 });
    expect(JSON.stringify(result)).not.toContain('r1');
  });

  it('uses one deterministic document per UTC hour', () => {
    expect(hourSnapshotId(AT_18H)).toBe(hourSnapshotId(AT_18H + 30 * 60 * 1000));
    expect(hourSnapshotId(AT_18H)).not.toBe(hourSnapshotId(AT_18H + 60 * 60 * 1000));
  });

  it('calculates average availability and requests per available driver', () => {
    const supply = aggregateSupplySnapshots([
      { timestampMs: AT_18H, online: { total: 4, moto: 3, car: 1 }, available: { total: 2, moto: 1, car: 1 } },
      { timestampMs: AT_18H + 7 * 864e5, online: { total: 6, moto: 4, car: 2 }, available: { total: 4, moto: 2, car: 2 } },
    ]);
    const hour = supply.averagesByHour.find((row) => row.hour === 18);
    expect(hour.averageOnline).toBe(5);
    expect(hour.averageAvailable).toBe(3);

    const demand = buildDemandSupply([{ hour: 18, requests: 12, noDriverAvailable: 2 }], [hour]);
    expect(demand[0]).toMatchObject({
      hour: 18,
      requests: 12,
      averageOnlineDrivers: 5,
      averageAvailableDrivers: 3,
      requestsPerAvailableDriver: 4,
    });
  });
});
