// @ts-check

const {
  buildSupplySnapshot,
  hourSnapshotId,
  canReceiveGenericLaunchRide,
} = require('../risk/supplySnapshots');
const {
  aggregateSupplySnapshots,
  buildDemandSupply,
} = require('../risk/analytics');

const AT_18H = Date.parse('2026-08-08T21:10:00.000Z'); // 18:10 Fortaleza

function eligibleDriver(overrides = {}) {
  return {
    verificationStatus: 'approved',
    isBlocked: false,
    availabilityStatus: 'online',
    activeRideId: null,
    founderEligible: false,
    freeRideCountUsed: 0,
    walletAvailableCentavos: 1000,
    location: { lat: -4.1, lng: -38.5 },
    locationUpdatedAtMs: AT_18H,
    availabilityUpdatedAtMs: AT_18H,
    ...overrides,
  };
}

describe('hourly driver supply analytics', () => {
  it('counts only approved and dispatchable moto/car supply without ids', () => {
    const result = buildSupplySnapshot([
      eligibleDriver({ vehicleType: 'moto' }),
      eligibleDriver({ vehicleType: 'moto', activeRideId: 'r1' }),
      eligibleDriver({ vehicleType: 'car' }),
      eligibleDriver({ vehicleType: 'car', availabilityStatus: 'offline' }),
      eligibleDriver({ vehicleType: 'car', isBlocked: true }),
      eligibleDriver({ vehicleType: 'car', verificationStatus: 'draft' }),
    ], AT_18H);

    expect(result.online).toEqual({ moto: 2, car: 1, total: 3 });
    expect(result.available).toEqual({ moto: 1, car: 1, total: 2 });
    expect(result.busy).toEqual({ moto: 1, car: 0, total: 1 });
    expect(result.approved).toEqual({ moto: 2, car: 2, total: 4 });
    expect(JSON.stringify(result)).not.toContain('r1');
  });

  it('excludes stale location, financial review and unusable wallet from availability', () => {
    const stale = eligibleDriver({ locationUpdatedAtMs: AT_18H - 2 * 3600000 });
    const review = eligibleDriver({ financialReviewRequired: true });
    const emptyWallet = eligibleDriver({ walletAvailableCentavos: 300, freeRideCountUsed: 5, subscriptionActive: true, subscriptionExpiresAt: AT_18H + 864e5 });
    const freeCommission = eligibleDriver({ walletAvailableCentavos: 0, commissionFreeUntil: AT_18H + 864e5 });

    expect(canReceiveGenericLaunchRide(stale, AT_18H)).toBe(false);
    expect(canReceiveGenericLaunchRide(review, AT_18H)).toBe(false);
    expect(canReceiveGenericLaunchRide(emptyWallet, AT_18H)).toBe(false);
    expect(canReceiveGenericLaunchRide(freeCommission, AT_18H)).toBe(true);
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
