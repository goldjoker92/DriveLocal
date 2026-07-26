const {
  LEGACY_CANCELLATION_REASON_MAP,
  normalizeLegacyCancellationReason,
  normalizedCancellationRequest,
} = require('../cancellationCompatibility');

describe('cancellation rollout compatibility', () => {
  it('maps only the two exact historical constants', () => {
    expect(LEGACY_CANCELLATION_REASON_MAP).toEqual({
      motorista_cancelou: 'driver_other',
      passageiro_cancelou: 'passenger_other',
    });
    expect(normalizeLegacyCancellationReason('motorista_cancelou')).toBe('driver_other');
    expect(normalizeLegacyCancellationReason('passageiro_cancelou')).toBe('passenger_other');
    expect(normalizeLegacyCancellationReason('arbitrary free text')).toBe('arbitrary free text');
  });

  it('returns the original request when no compatibility mapping is needed', () => {
    const request = {
      auth: { uid: 'driver-1' },
      data: { rideId: 'ride-1', idempotencyKey: 'cancel-key-001', reasonCode: 'unsafe_pickup' },
    };
    expect(normalizedCancellationRequest(request)).toBe(request);
  });

  it('copies the request without mutating the old client payload', () => {
    const request = {
      auth: { uid: 'driver-1' },
      data: { rideId: 'ride-1', idempotencyKey: 'cancel-key-001', reasonCode: 'motorista_cancelou' },
    };
    const normalized = normalizedCancellationRequest(request);

    expect(normalized).not.toBe(request);
    expect(normalized.data).not.toBe(request.data);
    expect(normalized.data.reasonCode).toBe('driver_other');
    expect(request.data.reasonCode).toBe('motorista_cancelou');
    expect(normalized.auth).toBe(request.auth);
  });
});