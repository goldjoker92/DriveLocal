const {
  DRIVER_CANCELLATION_REASONS,
  PASSENGER_CANCELLATION_REASONS,
  PASSENGER_NO_SHOW_WAIT_MS,
  CANCELLATION_FEE_POLICY_VERSION,
  isAllowedCancellationReason,
  cancellationStage,
  cancellationTiming,
  passengerNoShowEligibility,
} = require('../cancellationPolicy');

describe('ride cancellation policy', () => {
  it('keeps actor-specific reason vocabularies closed', () => {
    expect(DRIVER_CANCELLATION_REASONS).toEqual([
      'passenger_no_show',
      'pickup_address_incorrect',
      'unsafe_pickup',
      'vehicle_problem',
      'driver_other',
    ]);
    expect(PASSENGER_CANCELLATION_REASONS).toEqual([
      'no_longer_needed',
      'driver_delayed',
      'driver_not_moving',
      'driver_or_vehicle_mismatch',
      'passenger_safety_concern',
      'passenger_other',
    ]);
    expect(isAllowedCancellationReason('driver', 'unsafe_pickup')).toBe(true);
    expect(isAllowedCancellationReason('passenger', 'unsafe_pickup')).toBe(false);
    expect(isAllowedCancellationReason('passenger', 'free text')).toBe(false);
  });

  it('uses the explicit no-fee V1 policy', () => {
    expect(CANCELLATION_FEE_POLICY_VERSION).toBe('no-cancellation-fee-v1');
  });

  it('maps lifecycle statuses to privacy-safe relative stages', () => {
    expect(cancellationStage('searching')).toBe('before_assignment');
    expect(cancellationStage('assigned')).toBe('driver_en_route_to_pickup');
    expect(cancellationStage('driver_arrived')).toBe('driver_at_pickup');
    expect(cancellationStage('in_progress')).toBe('unknown');
  });

  it('records elapsed metadata without coordinates', () => {
    const nowMs = 1_000_000;
    const timing = cancellationTiming({
      status: 'driver_arrived',
      createdAtMs: nowMs - 500_000,
      acceptedAtMs: nowMs - 300_000,
      driverArrivedAtMs: nowMs - 120_000,
    }, nowMs);

    expect(timing).toEqual({
      cancellationElapsedSinceCreatedMs: 500_000,
      cancellationElapsedSinceAssignedMs: 300_000,
      cancellationWaitAfterArrivalMs: 120_000,
      driverHadArrived: true,
      driverArrivedAtMs: nowMs - 120_000,
      passengerNoShowEligibleAtMs: nowMs - 120_000 + PASSENGER_NO_SHOW_WAIT_MS,
    });
    for (const key of Object.keys(timing)) {
      expect(key).not.toMatch(/^(lat|lng|latitude|longitude|coordinates?)$/i);
    }
  });

  it('rejects passenger no-show before three complete minutes', () => {
    const arrivedAtMs = 1_000_000;
    const early = passengerNoShowEligibility(
      { status: 'driver_arrived', driverArrivedAtMs: arrivedAtMs },
      arrivedAtMs + PASSENGER_NO_SHOW_WAIT_MS - 1,
    );
    expect(early.eligible).toBe(false);
    expect(early.remainingMs).toBe(1);
  });

  it('accepts passenger no-show exactly at the threshold', () => {
    const arrivedAtMs = 1_000_000;
    const eligible = passengerNoShowEligibility(
      { status: 'driver_arrived', driverArrivedAtMs: arrivedAtMs },
      arrivedAtMs + PASSENGER_NO_SHOW_WAIT_MS,
    );
    expect(eligible.eligible).toBe(true);
    expect(eligible.remainingMs).toBe(0);
  });

  it('requires the driver-arrived phase even after enough elapsed time', () => {
    const result = passengerNoShowEligibility({
      status: 'assigned',
      driverArrivedAtMs: 1_000,
    }, 1_000 + PASSENGER_NO_SHOW_WAIT_MS + 60_000);
    expect(result.eligible).toBe(false);
    expect(result.correctPhase).toBe(false);
  });
});
