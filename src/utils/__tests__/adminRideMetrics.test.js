import {
  ADMIN_RIDE_METRIC_PERIODS,
  deriveAdminRideMetrics,
  formatAdminRideDecimal,
  formatAdminRideHour,
  formatAdminRideRate,
} from '../adminRideMetrics';

describe('admin ride metrics presentation', () => {
  it('maps every operational counter returned by the secure aggregate', () => {
    const metrics = deriveAdminRideMetrics({
      rides: {
        total: {
          requests: 20,
          assigned: 12,
          started: 10,
          completed: 8,
          noDriverAvailable: 5,
          cancelled: 3,
          commissionCapturedCentavos: 987,
          commissionExpectedCentavos: 1234,
        },
        byVehicle: {
          moto: { requests: 13, completed: 6 },
          car: { requests: 7, completed: 2 },
        },
        peakHours: [
          { hour: 18, requests: 8 },
          { hour: 19, requests: 5 },
        ],
        peakUnservedHours: [
          { hour: 19, noDriverAvailable: 4 },
          { hour: 18, noDriverAvailable: 1 },
        ],
        peakDays: [
          { label: 'Sexta', requests: 11 },
          { label: 'Sábado', requests: 9 },
        ],
      },
      supply: {
        latest: {
          online: { total: 7 },
          available: { total: 4 },
        },
        averagesByHour: [
          { hour: 18, sampleCount: 2 },
          { hour: 19, sampleCount: 2 },
        ],
        demandVsSupply: [
          { hour: 18, requests: 8, averageAvailableDrivers: 4, requestsPerAvailableDriver: 2 },
          { hour: 19, requests: 5, averageAvailableDrivers: 1, requestsPerAvailableDriver: 5 },
        ],
      },
      truncated: { rides: false },
    });

    expect(metrics).toMatchObject({
      requests: 20,
      assigned: 12,
      started: 10,
      completed: 8,
      noDriverAvailable: 5,
      cancelled: 3,
      assignmentRate: 0.6,
      startRate: 0.5,
      completionRate: 0.4,
      unservedRate: 0.25,
      cancellationRate: 0.15,
      commissionCapturedCentavos: 987,
      commissionExpectedCentavos: 1234,
      onlineDrivers: 7,
      availableDrivers: 4,
      peakDemandHour: 18,
      peakDemandRequests: 8,
      peakUnservedHour: 19,
      peakUnservedRequests: 4,
      peakDayLabel: 'Sexta',
      peakDayRequests: 11,
      peakPressureHour: 19,
      peakPressureRequests: 5,
      peakPressureRequestsPerDriver: 5,
      peakPressureHasNoAvailableDriver: false,
      motoRequests: 13,
      carRequests: 7,
      motoCompletionRate: 6 / 13,
      carCompletionRate: 2 / 7,
      ridesTruncated: false,
    });
    expect(metrics.commissionCaptureRate).toBeCloseTo(987 / 1234);
  });

  it('counts a no-driver request as a request without inventing a completed ride', () => {
    const metrics = deriveAdminRideMetrics({
      rides: {
        total: {
          requests: 1,
          noDriverAvailable: 1,
          completed: 0,
        },
      },
    });

    expect(metrics.requests).toBe(1);
    expect(metrics.noDriverAvailable).toBe(1);
    expect(metrics.completed).toBe(0);
    expect(formatAdminRideRate(metrics.unservedRate)).toBe('100,0%');
  });

  it('uses honest zero fallbacks and never exposes NaN or negative counters', () => {
    const metrics = deriveAdminRideMetrics({
      rides: {
        total: {
          requests: 'invalid',
          assigned: -3,
          completed: null,
        },
      },
    });

    expect(metrics).toMatchObject({
      requests: 0,
      assigned: 0,
      completed: 0,
      assignmentRate: 0,
      completionRate: 0,
      commissionCaptureRate: null,
      onlineDrivers: 0,
      availableDrivers: 0,
    });
    expect(formatAdminRideRate(undefined)).toBe('0,0%');
  });

  it('reports zero available supply only when that hour has a real snapshot', () => {
    const metrics = deriveAdminRideMetrics({
      supply: {
        averagesByHour: [
          { hour: 10, sampleCount: 0 },
          { hour: 11, sampleCount: 1 },
        ],
        demandVsSupply: [
          { hour: 10, requests: 20, averageAvailableDrivers: 0, requestsPerAvailableDriver: null },
          { hour: 11, requests: 3, averageAvailableDrivers: 0, requestsPerAvailableDriver: null },
        ],
      },
    });

    expect(metrics.peakPressureHour).toBe(11);
    expect(metrics.peakPressureRequests).toBe(3);
    expect(metrics.peakPressureRequestsPerDriver).toBeNull();
    expect(metrics.peakPressureHasNoAvailableDriver).toBe(true);
  });

  it('labels one day honestly as a rolling 24-hour window', () => {
    expect(ADMIN_RIDE_METRIC_PERIODS).toEqual([
      { days: 1, label: '24 h' },
      { days: 7, label: '7 dias' },
      { days: 30, label: '30 dias' },
      { days: 90, label: '90 dias' },
    ]);
    expect(formatAdminRideHour(23)).toBe('23h–00h');
    expect(formatAdminRideHour(null)).toBe('—');
    expect(formatAdminRideDecimal(2.75)).toBe('2,8');
  });
});
