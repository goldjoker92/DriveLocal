import {
  DRIVER_COCKPIT_STATS_VERSION,
  DRIVER_PERFORMANCE_STATS_VERSION,
  driverCockpitDisplayName,
  driverCockpitPeriodKeys,
  driverCockpitVehicle,
  deriveDriverCockpitSummary,
} from '../driverCockpitSummary';

function utc(iso) {
  return new Date(iso).getTime();
}

describe('compact driver cockpit summary', () => {
  it('uses Fortaleza day and Monday week boundaries', () => {
    expect(driverCockpitPeriodKeys(utc('2026-07-27T02:59:59.000Z'))).toEqual({
      dayKey: '2026-07-26',
      weekKey: '2026-07-20',
    });
    expect(driverCockpitPeriodKeys(utc('2026-07-27T03:00:00.000Z'))).toEqual({
      dayKey: '2026-07-27',
      weekKey: '2026-07-27',
    });
  });

  it('shows current real counters and resets stale periods to zero', () => {
    const current = deriveDriverCockpitSummary({
      cockpitStats: {
        version: DRIVER_COCKPIT_STATS_VERSION,
        dayKey: '2026-07-21',
        weekKey: '2026-07-20',
        todayRideCount: 3,
        todayReceivedCentavos: 4280,
        weekRideCount: 14,
        weekReceivedCentavos: 18640,
      },
      completedRideCount: 40,
      walletAvailableCentavos: 3000,
      walletHeldCentavos: 250,
      walletBalanceCentavos: 3250,
      walletStatus: 'ready',
    }, utc('2026-07-21T15:00:00.000Z'));

    expect(current).toMatchObject({
      todayRideCount: 3,
      todayReceivedCentavos: 4280,
      weekRideCount: 14,
      weekReceivedCentavos: 18640,
      totalCompletedRideCount: 40,
      walletAvailableCentavos: 3000,
      walletHeldCentavos: 250,
      walletBalanceCentavos: 3250,
      walletState: 'ready',
      walletStatusLabel: 'disponível para comissões',
      walletNeedsTopup: false,
      walletMinimumCentavos: 300,
      walletMinimumEligibleCentavos: 301,
      statsCurrent: true,
    });

    const stale = deriveDriverCockpitSummary({ cockpitStats: current }, utc('2026-07-28T15:00:00.000Z'));
    expect(stale.todayRideCount).toBe(0);
    expect(stale.todayReceivedCentavos).toBe(0);
    expect(stale.weekRideCount).toBe(0);
    expect(stale.weekReceivedCentavos).toBe(0);
  });

  it('derives acceptance and completion rates only from server performance counters', () => {
    const summary = deriveDriverCockpitSummary({
      completedRideCount: 42,
      driverPerformanceStats: {
        version: DRIVER_PERFORMANCE_STATS_VERSION,
        offersReceivedCount: 20,
        offersAcceptedCount: 15,
        terminalRideCount: 12,
        completedRideCount: 9,
        cancelledRideCount: 3,
        trackingStartedAtMs: 1785100000000,
      },
    });

    expect(summary).toMatchObject({
      totalCompletedRideCount: 42,
      offersReceivedCount: 20,
      offersAcceptedCount: 15,
      terminalRideCount: 12,
      trackedCompletedRideCount: 9,
      trackedCancelledRideCount: 3,
      acceptanceRateBps: 7500,
      completionRateBps: 7500,
      performanceStatsReady: true,
      performanceTrackingStartedAtMs: 1785100000000,
    });
  });

  it('does not fabricate rates before Firestore has a real denominator', () => {
    const summary = deriveDriverCockpitSummary({ completedRideCount: 4 });
    expect(summary.acceptanceRateBps).toBeNull();
    expect(summary.completionRateBps).toBeNull();
    expect(summary.performanceStatsReady).toBe(false);
    expect(summary.totalCompletedRideCount).toBe(4);
  });

  it('derives wallet readiness from commission policy and real balance, never stale walletStatus', () => {
    const now = utc('2026-07-21T15:00:00.000Z');

    const commissionFree = deriveDriverCockpitSummary({
      walletStatus: 'blocked',
      walletAvailableCentavos: 0,
      commissionFreeUntil: now + 10 * 24 * 60 * 60 * 1000,
    }, now);
    expect(commissionFree).toMatchObject({
      walletState: 'not_required',
      walletStatusLabel: 'nenhuma recarga necessária',
      walletNeedsTopup: false,
      commissionFree: true,
    });

    const thresholdBlocked = deriveDriverCockpitSummary({
      walletStatus: 'ready',
      walletAvailableCentavos: 300,
      commissionFreeUntil: now - 1,
    }, now);
    expect(thresholdBlocked).toMatchObject({
      walletState: 'blocked',
      walletStatusLabel: 'recarga necessária',
      walletNeedsTopup: true,
      walletMinimumCentavos: 300,
    });

    const aboveThreshold = deriveDriverCockpitSummary({
      walletStatus: 'blocked',
      walletAvailableCentavos: 301,
      commissionFreeUntil: now - 1,
    }, now);
    expect(aboveThreshold).toMatchObject({
      walletState: 'ready',
      walletStatusLabel: 'disponível para comissões',
      walletNeedsTopup: false,
    });
  });

  it('preserves a chosen display name but never uses email as identity', () => {
    expect(driverCockpitDisplayName({ displayName: 'Hell angel' })).toBe('Hell angel');
    expect(driverCockpitDisplayName({ fullName: 'Guillaume Ragot' })).toBe('Guillaume');
    expect(driverCockpitDisplayName({ displayName: 'driver@example.com' })).toBe('Motorista');
  });

  it('builds compact vehicle copy without private account data', () => {
    expect(driverCockpitVehicle({
      vehicleType: 'moto',
      vehicleBrand: 'Honda',
      vehicleModel: 'CG 160',
      vehicleColor: 'Preta',
      vehiclePlate: 'abc1d23',
    })).toEqual({
      typeLabel: 'Moto',
      emoji: '🏍',
      primary: 'Honda CG 160',
      secondary: 'Preta • ABC1D23',
    });
  });
});
