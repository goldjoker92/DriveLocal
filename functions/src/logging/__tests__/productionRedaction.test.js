const {
  REDACTED,
  deriveOperationalPhase,
  redactSensitiveData,
} = require('../logger');

describe('production structured log redaction', () => {
  it('redacts identity, exact location and Pix/provider payload fields recursively', () => {
    const input = {
      eventName: 'ride.lifecycle.succeeded',
      rideId: 'ride-safe-correlation',
      driverIdHash: 'safe-driver-hash',
      passengerId: 'private-passenger-uid',
      passengerName: 'Maria Silva',
      fullName: 'João Souza',
      pickup: {
        label: 'Rua Privada, 123',
        lat: -4.1,
        lng: -38.5,
      },
      exactDestination: {
        address: 'Destino privado',
        latitude: -4.11,
        longitude: -38.49,
      },
      paymentPixPayload: 'PIX-SECRET-PAYLOAD',
      providerPayload: { raw: 'provider-secret' },
      safe: {
        status: 'completed',
        result: 'succeeded',
        durationMs: 42,
      },
    };

    const output = redactSensitiveData(input);
    expect(output.eventName).toBe('ride.lifecycle.succeeded');
    expect(output.rideId).toBe('ride-safe-correlation');
    expect(output.driverIdHash).toBe('safe-driver-hash');
    expect(output.passengerId).toBe(REDACTED);
    expect(output.passengerName).toBe(REDACTED);
    expect(output.fullName).toBe(REDACTED);
    expect(output.pickup).toBe(REDACTED);
    expect(output.exactDestination).toBe(REDACTED);
    expect(output.paymentPixPayload).toBe(REDACTED);
    expect(output.providerPayload).toBe(REDACTED);
    expect(output.safe).toEqual({
      status: 'completed',
      result: 'succeeded',
      durationMs: 42,
    });

    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('Maria Silva');
    expect(serialized).not.toContain('João Souza');
    expect(serialized).not.toContain('Rua Privada');
    expect(serialized).not.toContain('Destino privado');
    expect(serialized).not.toContain('PIX-SECRET-PAYLOAD');
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('-4.1');
    expect(serialized).not.toContain('-38.5');
  });

  it('keeps non-reversible correlation hashes visible while redacting an exact RG field', () => {
    expect(redactSensitiveData({
      actorUid: 'raw-actor',
      actorUidHash: 'hash-actor',
      targetUserId: 'raw-target',
      targetUserIdHash: 'hash-target',
      rg: '2000000000',
    })).toEqual({
      actorUid: REDACTED,
      actorUidHash: 'hash-actor',
      targetUserId: REDACTED,
      targetUserIdHash: 'hash-target',
      rg: REDACTED,
    });
  });

  it('maps legacy event names into the shared production phase vocabulary', () => {
    expect(deriveOperationalPhase('wallet.topup.requested')).toBe('requested');
    expect(deriveOperationalPhase('ride.accept.started')).toBe('started');
    expect(deriveOperationalPhase('ride.accept.won')).toBe('succeeded');
    expect(deriveOperationalPhase('notification.failed')).toBe('failed');
    expect(deriveOperationalPhase('ride.arrived_replayed')).toBe('restored');
    expect(deriveOperationalPhase('notification.duplicate_ignored')).toBe('duplicate_ignored');
    expect(deriveOperationalPhase('custom.event', 'succeeded')).toBe('succeeded');
    expect(deriveOperationalPhase('custom.event', 'unsupported')).toBeNull();
  });
});