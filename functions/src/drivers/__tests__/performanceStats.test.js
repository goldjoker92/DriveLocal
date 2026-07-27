'use strict';

const {
  DRIVER_PERFORMANCE_STATS_VERSION,
  nextOfferReceivedStats,
  nextOfferAcceptedStats,
  nextTerminalRideStats,
  rateBps,
} = require('../performanceStats');

describe('driver performance statistics policy', () => {
  it('counts received and accepted offers without allowing an impossible rate', () => {
    const received = nextOfferReceivedStats({}, 1000);
    const accepted = nextOfferAcceptedStats(received, 1100);

    expect(accepted).toMatchObject({
      version: DRIVER_PERFORMANCE_STATS_VERSION,
      offersReceivedCount: 1,
      offersAcceptedCount: 1,
      trackingStartedAtMs: 1000,
      updatedAtMs: 1100,
    });
    expect(rateBps(accepted.offersAcceptedCount, accepted.offersReceivedCount)).toBe(10000);
  });

  it('stays coherent when the accepted trigger is delivered before the create trigger', () => {
    const acceptedFirst = nextOfferAcceptedStats({}, 1000);
    const receivedLater = nextOfferReceivedStats(acceptedFirst, 1100);

    expect(acceptedFirst.offersReceivedCount).toBe(1);
    expect(acceptedFirst.offersAcceptedCount).toBe(1);
    expect(receivedLater.offersReceivedCount).toBe(2);
    expect(receivedLater.offersAcceptedCount).toBe(1);
    expect(rateBps(1, 2)).toBe(5000);
  });

  it('counts completed rides and driver-caused cancellations as rated terminal outcomes', () => {
    const completed = nextTerminalRideStats({}, 'completed', 1000);
    const driverCancelled = nextTerminalRideStats(completed, 'driver_cancelled', 2000);

    expect(driverCancelled).toMatchObject({
      terminalRideCount: 2,
      completedRideCount: 1,
      cancelledRideCount: 1,
      excludedCancellationCount: 0,
    });
    expect(rateBps(
      driverCancelled.completedRideCount,
      driverCancelled.terminalRideCount
    )).toBe(5000);
  });

  it('records passenger-caused cancellations without lowering the driver rate', () => {
    const completed = nextTerminalRideStats({}, 'completed', 1000);
    const excluded = nextTerminalRideStats(completed, 'excluded_cancelled', 2000);

    expect(excluded).toMatchObject({
      terminalRideCount: 1,
      completedRideCount: 1,
      cancelledRideCount: 0,
      excludedCancellationCount: 1,
    });
    expect(rateBps(excluded.completedRideCount, excluded.terminalRideCount)).toBe(10000);
  });

  it('returns no rate without a denominator and clamps malformed values', () => {
    expect(rateBps(0, 0)).toBeNull();
    expect(rateBps(-2, 10)).toBe(0);
    expect(rateBps(20, 10)).toBe(10000);
  });
});
