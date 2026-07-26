const {
  RECENT_AUTH_MAX_AGE_MS,
  assertConfirmation,
  recentAuthentication,
  createAnonymousSubjectId,
  buildRideAnonymizationUpdate,
  buildFinancialPseudonymizationUpdate,
} = require('../deletionPolicy');

describe('account deletion policy', () => {
  it('requires the explicit EXCLUIR confirmation', () => {
    expect(assertConfirmation('EXCLUIR')).toBe(true);
    expect(assertConfirmation(' excluir ')).toBe(true);
    expect(assertConfirmation('delete')).toBe(false);
  });

  it('accepts only a recently authenticated Firebase token', () => {
    const nowMs = 2_000_000;
    expect(recentAuthentication({ auth_time: (nowMs - RECENT_AUTH_MAX_AGE_MS + 1) / 1000 }, nowMs)).toBe(true);
    expect(recentAuthentication({ auth_time: (nowMs - RECENT_AUTH_MAX_AGE_MS - 1) / 1000 }, nowMs)).toBe(false);
    expect(recentAuthentication({}, nowMs)).toBe(false);
  });

  it('creates a random non-uid anonymous subject reference', () => {
    const result = createAnonymousSubjectId('driver', () => '123e4567-e89b-12d3-a456-426614174000');
    expect(result).toBe('deleted_driver_123e4567-e89b-12d3-a456-426614174000');
    expect(result).not.toContain('firebase-user-id');
  });

  it('removes passenger identity and exact route data while retaining ride totals/status', () => {
    const deleted = Symbol('delete');
    const update = buildRideAnonymizationUpdate({
      role: 'passenger',
      anonymousSubjectId: 'deleted_passenger_random',
      ride: {
        passengerId: 'uid-secret',
        pickupPreview: { label: 'Rua privada' },
        passengerPhone: '85999999999',
        fareCentavos: 1200,
        status: 'completed',
      },
      deleteField: deleted,
    });

    expect(update).toMatchObject({
      passengerId: 'deleted_passenger_random',
      passengerDeleted: true,
      pickup: { label: 'Local removido' },
      destination: { label: 'Local removido' },
      acceptedPassengerPublic: {
        firstName: 'Passageiro excluído',
        photoStoragePath: null,
        photoVerified: false,
      },
    });
    expect(update.pickupPreview).toBe(deleted);
    expect(update.passengerPhone).toBe(deleted);
    expect(update).not.toHaveProperty('fareCentavos');
    expect(update).not.toHaveProperty('status');
  });

  it('removes driver photo, plate and work-session identity from ride snapshots', () => {
    const deleted = Symbol('delete');
    const update = buildRideAnonymizationUpdate({
      role: 'driver',
      anonymousSubjectId: 'deleted_driver_random',
      ride: {
        acceptedDriverId: 'driver-secret',
        acceptedAvailabilitySessionId: 'session-secret',
        acceptedDriverPublic: {
          name: 'Real Name',
          vehicleType: 'moto',
          vehiclePlate: 'ABC1D23',
          photoStoragePath: 'publicDriverPhotos/secret/photo.jpg',
        },
      },
      deleteField: deleted,
    });

    expect(update.acceptedDriverId).toBe('deleted_driver_random');
    expect(update.acceptedAvailabilitySessionId).toBe(deleted);
    expect(update.acceptedDriverPublic).toMatchObject({
      name: 'Motorista excluído',
      vehicleType: 'moto',
      vehiclePlate: '—',
      photoStoragePath: null,
      photoVerified: false,
    });
  });

  it('pseudonymizes financial records and removes payment secrets', () => {
    const deleted = Symbol('delete');
    const update = buildFinancialPseudonymizationUpdate({
      anonymousSubjectId: 'deleted_driver_random',
      deleteField: deleted,
    });

    expect(update.driverId).toBe('deleted_driver_random');
    expect(update.qrCode).toBe(deleted);
    expect(update.qrCodeBase64).toBe(deleted);
    expect(update.idempotencyKey).toBe(deleted);
    expect(update.idempotencyFingerprint).toBe(deleted);
  });
});
