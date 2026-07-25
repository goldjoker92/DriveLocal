// @ts-check

const {
  aggregateRides,
  aggregateDrivers,
  buildAdminAnalytics,
} = require('../risk/analytics');
const { commissionSettlementFromRide } = require('../rides/lifecycle');
const { settlementFromFrozenHold } = require('../rides/disputeResolution');
const { buildCommissionPolicySnapshot } = require('../rides/acceptOffer');

const NOW = Date.parse('2026-08-10T15:00:00.000Z');

describe('launch antifraud business analytics', () => {
  it('separates moto/car commissions and finds peak demand in Fortaleza time', () => {
    const rides = [
      {
        rideId: 'm1',
        vehicleType: 'moto',
        status: 'completed',
        createdAtMs: Date.parse('2026-08-08T21:10:00.000Z'), // 18:10 Fortaleza
        acceptedDriverId: 'd1',
        startedAtMs: Date.parse('2026-08-08T21:20:00.000Z'),
        finalFareCentavos: 1000,
        finalCommissionCentavos: 150,
        commissionCapturedCentavos: 150,
      },
      {
        rideId: 'm2',
        vehicleType: 'moto',
        status: 'no_driver_available',
        createdAtMs: Date.parse('2026-08-08T21:30:00.000Z'),
        estimatedFareCentavos: 800,
        estimatedCommissionCentavos: 120,
      },
      {
        rideId: 'c1',
        vehicleType: 'car',
        status: 'completed',
        createdAtMs: Date.parse('2026-08-08T22:05:00.000Z'), // 19:05 Fortaleza
        acceptedDriverId: 'd2',
        startedAtMs: Date.parse('2026-08-08T22:15:00.000Z'),
        finalFareCentavos: 2000,
        finalCommissionCentavos: 300,
        commissionCapturedCentavos: 300,
      },
    ];

    const result = aggregateRides(rides);
    expect(result.byVehicle.moto.requests).toBe(2);
    expect(result.byVehicle.moto.commissionCapturedCentavos).toBe(150);
    expect(result.byVehicle.car.commissionCapturedCentavos).toBe(300);
    expect(result.total.commissionCapturedCentavos).toBe(450);
    expect(result.peakHours[0]).toMatchObject({ hour: 18, requests: 2, noDriverAvailable: 1 });
    expect(result.peakRevenueHours[0]).toMatchObject({ hour: 19, commissionCapturedCentavos: 300 });
  });

  it('counts paid/free subscriptions and calculates exact moto/car MRR', () => {
    const drivers = [
      {
        vehicleType: 'moto',
        verificationStatus: 'approved',
        subscriptionActive: true,
        subscriptionExpiresAt: NOW + 20 * 864e5,
        walletAvailableCentavos: 200,
        walletHeldCentavos: 100,
      },
      {
        vehicleType: 'car',
        verificationStatus: 'approved',
        subscriptionActive: true,
        subscriptionExpiresAt: NOW + 5 * 864e5,
        walletAvailableCentavos: 500,
        walletHeldCentavos: 0,
      },
      {
        vehicleType: 'moto',
        verificationStatus: 'approved',
        subscriptionActive: false,
        subscriptionFreeUntil: NOW + 10 * 864e5,
        walletAvailableCentavos: 1000,
        walletHeldCentavos: 0,
      },
    ];

    const result = aggregateDrivers(drivers, NOW);
    expect(result.activeSubscriptions).toEqual({ moto: 1, car: 1, total: 2 });
    expect(result.freeSubscriptions).toEqual({ moto: 1, car: 0, total: 1 });
    expect(result.expiringWithin7Days).toEqual({ moto: 0, car: 1, total: 1 });
    expect(result.lowWallet).toEqual({ moto: 1, car: 0, total: 1 });
    expect(result.theoreticalMrrCentavos).toEqual({ moto: 990, car: 1990, total: 2980 });
  });

  it('keeps subscription revenue separate from wallet top-ups', () => {
    const result = buildAdminAnalytics({
      rides: [{
        rideId: 'r1',
        vehicleType: 'car',
        status: 'completed',
        createdAtMs: NOW,
        finalCommissionCentavos: 300,
        commissionCapturedCentavos: 300,
      }],
      drivers: [],
      payments: [
        { status: 'paid', purpose: 'driver_subscription', amountCentavos: 1990 },
        { status: 'paid', purpose: 'wallet_topup', amountCentavos: 5000 },
      ],
      alerts: [],
      nowMs: NOW,
      rangeDays: 30,
    });

    expect(result.revenue.commissionRevenueCentavos).toBe(300);
    expect(result.revenue.subscriptionRevenueCentavos).toBe(1990);
    expect(result.revenue.confirmedRevenueCentavos).toBe(2290);
    expect(result.payments.walletTopupsCentavos).toBe(5000);
  });
});

describe('commission integrity', () => {
  it('freezes the commission policy and hold when the driver accepts', () => {
    const snapshot = buildCommissionPolicySnapshot(
      { estimatedCommissionCentavos: 150, pricingConfigVersion: 'pricing-v7' },
      150,
      false,
      NOW
    );
    expect(snapshot).toEqual({
      policyVersion: 'commission-hold-v1',
      pricingConfigVersion: 'pricing-v7',
      estimatedCommissionCentavos: 150,
      holdAmountCentavos: 150,
      commissionFreeAtAcceptance: false,
      acceptedAtMs: NOW,
    });
  });

  it('captures from the frozen hold even if a promotion changes later', () => {
    const ride = {
      commissionHoldCentavos: 150,
      finalCommissionCentavos: 120,
      commissionPolicySnapshot: { commissionFreeAtAcceptance: false },
    };
    expect(commissionSettlementFromRide(ride)).toEqual({
      originalHold: 150,
      finalCommission: 120,
      captured: 120,
      released: 30,
    });
    expect(settlementFromFrozenHold(ride)).toEqual({
      originalHold: 150,
      finalCommission: 120,
      captured: 120,
      released: 30,
    });
  });

  it('never captures more than the amount held', () => {
    const settlement = commissionSettlementFromRide({
      commissionHoldCentavos: 100,
      finalCommissionCentavos: 180,
    });
    expect(settlement).toEqual({
      originalHold: 100,
      finalCommission: 180,
      captured: 100,
      released: 0,
    });
  });
});
