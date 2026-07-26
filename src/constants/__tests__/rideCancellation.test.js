const {
  DRIVER_CANCELLATION_REASONS,
  PASSENGER_CANCELLATION_REASONS,
  PASSENGER_NO_SHOW_WAIT_MS,
  normalizeCancellationReason,
  noShowRemainingMs,
  formatWaitDuration,
} = require('../rideCancellation');

describe('mobile ride cancellation domain', () => {
  it('presents all approved driver reasons', () => {
    expect(DRIVER_CANCELLATION_REASONS.map((reason) => reason.code)).toEqual([
      'passenger_no_show',
      'pickup_address_incorrect',
      'unsafe_pickup',
      'vehicle_problem',
      'driver_other',
    ]);
  });

  it('presents all approved passenger reasons', () => {
    expect(PASSENGER_CANCELLATION_REASONS.map((reason) => reason.code)).toEqual([
      'no_longer_needed',
      'driver_delayed',
      'driver_not_moving',
      'driver_or_vehicle_mismatch',
      'passenger_safety_concern',
      'passenger_other',
    ]);
  });

  it('normalizes only known legacy codes', () => {
    expect(normalizeCancellationReason('motorista_cancelou', 'driver')).toBe('driver_other');
    expect(normalizeCancellationReason('passageiro_cancelou', 'passenger')).toBe('passenger_other');
    expect(normalizeCancellationReason('unsafe_pickup', 'driver')).toBe('unsafe_pickup');
    expect(normalizeCancellationReason('arbitrary', 'driver')).toBe('arbitrary');
  });

  it('uses the same three-minute no-show timer as the backend', () => {
    expect(PASSENGER_NO_SHOW_WAIT_MS).toBe(180000);
    const arrivedAtMs = 1_000_000;
    expect(noShowRemainingMs(arrivedAtMs, arrivedAtMs + 60_000)).toBe(120_000);
    expect(noShowRemainingMs(arrivedAtMs, arrivedAtMs + 180_000)).toBe(0);
  });

  it('formats the countdown without negative values', () => {
    expect(formatWaitDuration(125_000)).toBe('02:05');
    expect(formatWaitDuration(0)).toBe('00:00');
    expect(formatWaitDuration(-1)).toBe('00:00');
  });
});