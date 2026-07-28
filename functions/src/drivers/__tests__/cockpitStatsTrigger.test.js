'use strict';

const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const {
  cockpitStatsUpdateNeeded,
  completedRideFareCentavos,
  applyCompletedRideToCockpit,
} = require('../cockpitStatsTrigger');
const { COCKPIT_STATS_VERSION } = require('../cockpitStats');
const C = require('../../rides/constants');

const RIDE_ID = 'ride_cockpit_001';
const DRIVER_ID = 'driver_cockpit_001';
const NOW_MS = new Date('2026-07-21T15:00:00.000Z').getTime();
const CONTEXT = { traceId: 'trace_cockpit_stats', environment: 'test' };

describe('driver cockpit statistics trigger', () => {
  it('runs only on the first transition to completed', () => {
    expect(cockpitStatsUpdateNeeded(
      { status: C.RIDE_STATUS.PAYMENT_MARKED_SENT },
      { status: C.RIDE_STATUS.COMPLETED, acceptedDriverId: DRIVER_ID }
    )).toBe(true);
    expect(cockpitStatsUpdateNeeded(
      { status: C.RIDE_STATUS.COMPLETED },
      { status: C.RIDE_STATUS.COMPLETED, acceptedDriverId: DRIVER_ID }
    )).toBe(false);
    expect(cockpitStatsUpdateNeeded(
      { status: C.RIDE_STATUS.IN_PROGRESS },
      { status: C.RIDE_STATUS.AWAITING_PAYMENT, acceptedDriverId: DRIVER_ID }
    )).toBe(false);
  });

  it('uses final fare first and safe fallbacks after it', () => {
    expect(completedRideFareCentavos({
      finalFareCentavos: 1300,
      paymentAmountCentavos: 1200,
      estimatedFareCentavos: 1100,
    })).toBe(1300);
    expect(completedRideFareCentavos({ paymentAmountCentavos: 1200 })).toBe(1200);
    expect(completedRideFareCentavos({ estimatedFareCentavos: 1100 })).toBe(1100);
    expect(completedRideFareCentavos({ finalFareCentavos: -1 })).toBe(0);
  });

  it('writes real daily and weekly aggregates and marks the ride once', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc(DRIVER_ID).set({
      completedRideCount: 7,
      cockpitStats: {
        dayKey: '2026-07-21',
        weekKey: '2026-07-20',
        todayRideCount: 2,
        todayReceivedCentavos: 2100,
        weekRideCount: 4,
        weekReceivedCentavos: 4800,
      },
    });
    await db.collection(C.RIDE_REQUESTS).doc(RIDE_ID).set({
      rideId: RIDE_ID,
      acceptedDriverId: DRIVER_ID,
      status: C.RIDE_STATUS.COMPLETED,
      completedAtMs: NOW_MS,
      finalFareCentavos: 1250,
    });

    const result = await applyCompletedRideToCockpit({
      db,
      rideId: RIDE_ID,
      context: CONTEXT,
      clock: { now: () => NOW_MS + 10 },
    });

    expect(result.action).toBe('succeeded');
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    const ride = db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`);
    expect(driver.cockpitStats).toMatchObject({
      version: COCKPIT_STATS_VERSION,
      dayKey: '2026-07-21',
      weekKey: '2026-07-20',
      todayRideCount: 3,
      todayReceivedCentavos: 3350,
      weekRideCount: 5,
      weekReceivedCentavos: 6050,
    });
    expect(ride.cockpitStatsAppliedVersion).toBe(COCKPIT_STATS_VERSION);
    expect(ride.cockpitStatsAppliedAtMs).toBe(NOW_MS + 10);
  });

  it('ignores retries after the private ride marker exists', async () => {
    const db = makeFakeFirestore();
    await db.collection(C.DRIVERS).doc(DRIVER_ID).set({});
    await db.collection(C.RIDE_REQUESTS).doc(RIDE_ID).set({
      acceptedDriverId: DRIVER_ID,
      status: C.RIDE_STATUS.COMPLETED,
      completedAtMs: NOW_MS,
      finalFareCentavos: 900,
      cockpitStatsAppliedVersion: COCKPIT_STATS_VERSION,
    });

    const result = await applyCompletedRideToCockpit({
      db,
      rideId: RIDE_ID,
      context: CONTEXT,
      clock: { now: () => NOW_MS },
    });

    expect(result.action).toBe('duplicate_ignored');
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.cockpitStats).toBeUndefined();
  });
});