import {
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
      routeDistanceMeters: 5000,
      routeDurationSeconds: 900,
      hasPickup: true,
      hasDestination: true,
      pickupLabelPresent: true,
      destinationLabelPresent: true,
      hasAcceptedDriver: true,
      hasPixPaymentPayload: true,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Rua privada');
    expect(serialized).not.toContain('Destino privado');
    expect(serialized).not.toContain('PIX-SECRET-PAYLOAD');
    expect(serialized).not.toContain('85999999999');
    expect(serialized).not.toContain('driver_private_uid');
    expect(serialized).not.toContain('-4.1');
    expect(serialized).not.toContain('-38.5');
  });

  it('normalizes Firebase callable error details without stacks or causes', () => {
    const error = new Error('fallback message');
    error.code = 'functions/failed-precondition';
    error.details = {
      code: 'OUT_OF_SERVICE_AREA',
      message: 'Ainda não atendemos esta área.',
      retryable: false,
    };
    error.stack = 'private stack';

    expect(sanitizeRideErrorForClientLog(error)).toEqual({
      errorCode: 'OUT_OF_SERVICE_AREA',
      errorMessage: 'Ainda não atendemos esta área.',
      retryable: false,
    });
    expect(JSON.stringify(sanitizeRideErrorForClientLog(error))).not.toContain('private stack');
  });
});
