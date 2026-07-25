// @ts-check

const {
  detectOperationalPatterns,
  CANCELLATION_THRESHOLD,
  DISPUTE_THRESHOLD,
  PAIR_THRESHOLD,
} = require('../risk/operationalScan');
const riskC = require('../risk/constants');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function reasonSignals(signals, reasonCode) {
  return signals.filter((signal) => signal.reasonCode === reasonCode);
}

describe('operational launch antifraud scan', () => {
  it('flags repeated passenger cancellations without auto-banning', () => {
    const rides = Array.from({ length: CANCELLATION_THRESHOLD }, (_, index) => ({
      rideId: `cancel_${index}`,
      status: 'cancelled',
      cancelledBy: 'passenger',
      passengerId: 'p1',
      acceptedDriverId: 'd1',
    }));
    const signals = detectOperationalPatterns(rides, NOW);
    const repeated = reasonSignals(signals, riskC.REASON.REPEATED_CANCELLATIONS);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({
      actorType: 'passenger',
      actorId: 'p1',
      recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
    });
  });

  it('flags repeated resolved false-payment patterns against the passenger', () => {
    const rides = Array.from({ length: DISPUTE_THRESHOLD }, (_, index) => ({
      rideId: `dispute_${index}`,
      status: 'completed',
      passengerId: 'p-risk',
      acceptedDriverId: `d${index}`,
      disputeResolution: { outcome: 'confirm_driver_payment' },
    }));
    const signals = detectOperationalPatterns(rides, NOW);
    expect(reasonSignals(signals, riskC.REASON.PASSENGER_FALSE_PAYMENT_PATTERN)[0]).toMatchObject({
      actorType: 'passenger',
      actorId: 'p-risk',
      severity: 'high',
    });
  });

  it('opens review signals for a highly repeated driver-passenger pair', () => {
    const rides = Array.from({ length: PAIR_THRESHOLD }, (_, index) => ({
      rideId: `pair_${index}`,
      status: 'completed',
      passengerId: 'p1',
      acceptedDriverId: 'd1',
      routeDistanceMeters: 500,
      routeDurationSeconds: 120,
      startedAtMs: NOW - 300000,
      completedAtMs: NOW,
    }));
    const signals = detectOperationalPatterns(rides, NOW);
    const pair = reasonSignals(signals, riskC.REASON.REPEATED_DRIVER_PASSENGER_PAIR);
    expect(pair).toHaveLength(2);
    expect(pair.map((entry) => entry.actorType).sort()).toEqual(['driver', 'passenger']);
  });

  it('flags an implausibly short completed ride for both parties', () => {
    const signals = detectOperationalPatterns([{
      rideId: 'fast_ride',
      status: 'completed',
      passengerId: 'p1',
      acceptedDriverId: 'd1',
      vehicleType: 'car',
      routeDistanceMeters: 10000,
      routeDurationSeconds: 1200,
      startedAtMs: NOW - 30000,
      completedAtMs: NOW,
    }], NOW);
    const shortRide = reasonSignals(signals, riskC.REASON.SUSPICIOUS_RIDE_DURATION);
    expect(shortRide).toHaveLength(2);
    expect(shortRide.every((entry) => entry.recommendedAction === riskC.ACTION.REQUIRE_REVIEW)).toBe(true);
  });

  it('does not flag an ordinary completed ride', () => {
    const signals = detectOperationalPatterns([{
      rideId: 'normal_ride',
      status: 'completed',
      passengerId: 'p1',
      acceptedDriverId: 'd1',
      routeDistanceMeters: 5000,
      routeDurationSeconds: 900,
      startedAtMs: NOW - 1000000,
      completedAtMs: NOW,
    }], NOW);
    expect(signals).toEqual([]);
  });
});
