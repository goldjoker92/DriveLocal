import {
  DRIVER_COCKPIT_STATS_VERSION,
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
      statsCurrent: true,
    });

    const stale = deriveDriverCockpitSummary({ cockpitStats: current }, utc('2026-07-28T15:00:00.000Z'));
    expect(stale.todayRideCount).toBe(0);
    expect(stale.todayReceivedCentavos).toBe(0);
    expect(stale.weekRideCount).toBe(0);
    expect(stale.weekReceivedCentavos).toBe(0);
  });

  it('never uses an email as the cockpit display name', () => {
    expect(driverCockpitDisplayName({ displayName: 'Hell angel' })).toBe('Hell');
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