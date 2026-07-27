import {
  deriveOperationalPhase,
  sanitizeRideErrorForClientLog,
  sanitizeRideForClientLog,
} from '../clientRideLog';

describe('client ride debug logs', () => {
  it('keeps operational ride fields while redacting private location and payment values', () => {
    const snapshot = sanitizeRideForClientLog({
      rideId: 'ride_debug_001',
      traceId: 'trace_debug_001',
      status: 'searching',
      serviceAreaId: 'horizonte-ce',
      vehicleType: 'moto',
      estimatedFareCentavos: 905,
      commissionDisplayBps: 1200,
      commissionHoldCentavos: 109,
      commissionCapturedCentavos: 109,
      holdReleasedCentavos: 0,
      routeDistanceMeters: 5000,
      routeDurationSeconds: 900,
      pricingConfigVersion: 'pricing-v1',
      pickup: { lat: -4.1, lng: -38.5, label: 'Rua privada, 123' },
      destination: { lat: -4.11, lng: -38.49, label: 'Destino privado' },
      paymentPixPayload: 'PIX-SECRET-PAYLOAD',
      passengerPhone: '85999999999',
      acceptedDriverId: 'driver_private_uid',
    });

    expect(snapshot).toMatchObject({
      rideId: 'ride_debug_001',
      traceId: 'trace_debug_001',
      status: 'searching',
      serviceAreaId: 'horizonte-ce',
      vehicleType: 'moto',
      estimatedFareCentavos: 905,
      commissionDisplayBps: 1200,
      routeDistanceMeters: 5000,
      routeDurationSeconds: 900,
      hasPickup: true,
      hasDestination: true,
      pickupLabelPresent: true,
      destinationLabelPresent: true,
      hasAcceptedDriver: true,
      hasPixPaymentPayload: true,
    });
    expect(snapshot).not.toHaveProperty('commissionHoldCentavos');
    expect(snapshot).not.toHaveProperty('commissionCapturedCentavos');
    expect(snapshot).not.toHaveProperty('holdReleasedCentavos');
    expect(snapshot).not.toHaveProperty('availableFields');

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Rua privada');
    expect(serialized).not.toContain('Destino privado');
    expect(serialized).not.toContain('PIX-SECRET-PAYLOAD');
    expect(serialized).not.toContain('85999999999');
    expect(serialized).not.toContain('driver_private_uid');
    expect(serialized).not.toContain('-4.1');
    expect(serialized).not.toContain('-38.5');
  });

  it('drops commission percentages outside the closed 0/12/15 vocabulary', () => {
    expect(sanitizeRideForClientLog({ commissionDisplayBps: 940 }))
      .not.toHaveProperty('commissionDisplayBps');
    expect(sanitizeRideForClientLog({ commissionDisplayBps: 0 }).commissionDisplayBps).toBe(0);
    expect(sanitizeRideForClientLog({ commissionDisplayBps: 1500 }).commissionDisplayBps).toBe(1500);
  });

  it('keeps only stable error codes and retryability, never free text', () => {
    const error = new Error('Rua privada, 123 — João — 85999999999');
    error.code = 'functions/failed-precondition';
    error.details = {
      code: 'OUT_OF_SERVICE_AREA',
      message: 'Destino privado com payload PIX-SECRET-PAYLOAD.',
      retryable: false,
    };
    error.stack = 'private stack';

    expect(sanitizeRideErrorForClientLog(error)).toEqual({
      errorCode: 'OUT_OF_SERVICE_AREA',
      retryable: false,
    });
    const serialized = JSON.stringify(sanitizeRideErrorForClientLog(error));
    expect(serialized).not.toContain('Rua privada');
    expect(serialized).not.toContain('Destino privado');
    expect(serialized).not.toContain('João');
    expect(serialized).not.toContain('85999999999');
    expect(serialized).not.toContain('PIX-SECRET-PAYLOAD');
    expect(serialized).not.toContain('private stack');
  });

  it('normalizes existing event names into the shared operational phase vocabulary', () => {
    expect(deriveOperationalPhase('work_session.start_requested')).toBe('requested');
    expect(deriveOperationalPhase('ride.accept.started')).toBe('started');
    expect(deriveOperationalPhase('ride.accept.won')).toBe('succeeded');
    expect(deriveOperationalPhase('notification.failed')).toBe('failed');
    expect(deriveOperationalPhase('network.connection.recovered')).toBe('restored');
    expect(deriveOperationalPhase('notification.duplicate_ignored')).toBe('duplicate_ignored');
    expect(deriveOperationalPhase('custom.event', 'succeeded')).toBe('succeeded');
    expect(deriveOperationalPhase('custom.event', 'unknown')).toBeNull();
  });
});
