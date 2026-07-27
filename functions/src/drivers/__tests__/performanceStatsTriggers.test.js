'use strict';

const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');
const C = require('../../rides/constants');
const { DRIVER_PERFORMANCE_STATS_VERSION } = require('../performanceStats');
const {
  OFFER_RECEIVED_MARKER,
  OFFER_ACCEPTED_MARKER,
  RIDE_TERMINAL_MARKER,
  offerAcceptedTransition,
  terminalRideTransition,
  applyOfferReceivedStats,
  applyOfferAcceptedStats,
  applyTerminalRideStats,
} = require('../performanceStatsTriggers');

const DRIVER_ID = 'driver_performance_001';
const OFFER_ID = 'ride_performance_001_driver_performance_001';
const RIDE_ID = 'ride_performance_001';
const CONTEXT = { traceId: 'trace_performance_stats', environment: 'test' };
const CLOCK = { now: () => 1785100000000 };

async function seedDriver(db) {
  await db.collection(C.DRIVERS).doc(DRIVER_ID).set({ verificationStatus: 'approved' });
}

describe('driver performance statistics triggers', () => {
  it('recognizes only first accepted and terminal transitions', () => {
    expect(offerAcceptedTransition(
      { status: C.OFFER_STATUS.OFFERED },
      { status: C.OFFER_STATUS.ACCEPTED, driverId: DRIVER_ID }
    )).toBe(true);
    expect(offerAcceptedTransition(
      { status: C.OFFER_STATUS.ACCEPTED },
      { status: C.OFFER_STATUS.ACCEPTED, driverId: DRIVER_ID }
    )).toBe(false);
    expect(terminalRideTransition(
      { status: C.RIDE_STATUS.PAYMENT_MARKED_SENT },
      { status: C.RIDE_STATUS.COMPLETED, acceptedDriverId: DRIVER_ID }
    )).toBe(true);
    expect(terminalRideTransition(
      { status: C.RIDE_STATUS.COMPLETED },
      { status: C.RIDE_STATUS.COMPLETED, acceptedDriverId: DRIVER_ID }
    )).toBe(false);
  });

  it('counts an offer received once and ignores retries', async () => {
    const db = makeFakeFirestore();
    await seedDriver(db);
    await db.collection(C.DRIVER_OFFERS).doc(OFFER_ID).set({
      driverId: DRIVER_ID,
      status: C.OFFER_STATUS.OFFERED,
    });

    const first = await applyOfferReceivedStats({ db, offerId: OFFER_ID, context: CONTEXT, clock: CLOCK });
    const second = await applyOfferReceivedStats({ db, offerId: OFFER_ID, context: CONTEXT, clock: CLOCK });

    expect(first.action).toBe('succeeded');
    expect(second.action).toBe('duplicate_ignored');
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    const offer = db._store.get(`${C.DRIVER_OFFERS}/${OFFER_ID}`);
    expect(driver.driverPerformanceStats.offersReceivedCount).toBe(1);
    expect(driver.driverPerformanceStats.offersAcceptedCount).toBe(0);
    expect(offer[OFFER_RECEIVED_MARKER]).toBe(DRIVER_PERFORMANCE_STATS_VERSION);
  });

  it('recovers the received event when acceptance is projected first', async () => {
    const db = makeFakeFirestore();
    await seedDriver(db);
    await db.collection(C.DRIVER_OFFERS).doc(OFFER_ID).set({
      driverId: DRIVER_ID,
      status: C.OFFER_STATUS.ACCEPTED,
    });

    const accepted = await applyOfferAcceptedStats({ db, offerId: OFFER_ID, context: CONTEXT, clock: CLOCK });
    const lateCreate = await applyOfferReceivedStats({ db, offerId: OFFER_ID, context: CONTEXT, clock: CLOCK });

    expect(accepted.action).toBe('succeeded');
    expect(accepted.receivedRecovered).toBe(true);
    expect(lateCreate.action).toBe('duplicate_ignored');
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    const offer = db._store.get(`${C.DRIVER_OFFERS}/${OFFER_ID}`);
    expect(driver.driverPerformanceStats).toMatchObject({
      offersReceivedCount: 1,
      offersAcceptedCount: 1,
    });
    expect(offer[OFFER_RECEIVED_MARKER]).toBe(DRIVER_PERFORMANCE_STATS_VERSION);
    expect(offer[OFFER_ACCEPTED_MARKER]).toBe(DRIVER_PERFORMANCE_STATS_VERSION);
  });

  it('counts completed and cancelled accepted rides exactly once', async () => {
    const db = makeFakeFirestore();
    await seedDriver(db);
    await db.collection(C.RIDE_REQUESTS).doc(RIDE_ID).set({
      acceptedDriverId: DRIVER_ID,
      status: C.RIDE_STATUS.COMPLETED,
    });

    const completed = await applyTerminalRideStats({ db, rideId: RIDE_ID, context: CONTEXT, clock: CLOCK });
    const replay = await applyTerminalRideStats({ db, rideId: RIDE_ID, context: CONTEXT, clock: CLOCK });
    expect(completed.action).toBe('succeeded');
    expect(replay.action).toBe('duplicate_ignored');

    await db.collection(C.RIDE_REQUESTS).doc('ride_performance_002').set({
      acceptedDriverId: DRIVER_ID,
      status: C.RIDE_STATUS.CANCELLED,
    });
    await applyTerminalRideStats({
      db,
      rideId: 'ride_performance_002',
      context: CONTEXT,
      clock: { now: () => CLOCK.now() + 1 },
    });

    const driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    const ride = db._store.get(`${C.RIDE_REQUESTS}/${RIDE_ID}`);
    expect(driver.driverPerformanceStats).toMatchObject({
      terminalRideCount: 2,
      completedRideCount: 1,
      cancelledRideCount: 1,
    });
    expect(ride[RIDE_TERMINAL_MARKER]).toBe(DRIVER_PERFORMANCE_STATS_VERSION);
  });
});
