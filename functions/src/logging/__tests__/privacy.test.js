const {
  createLoggerContext,
  redactSensitiveData,
  shortHash,
  REDACTED,
} = require('../logger');

describe('structured logger identity privacy', () => {
  it('keeps a handler-compatible actorUid but redacts it from the log entry', () => {
    const context = createLoggerContext({
      traceId: 'trace_privacy',
      functionName: 'testFunction',
      actorType: 'driver',
      actorUid: 'raw-firebase-user-id',
    });

    expect(context.actorUid).toBe('raw-firebase-user-id');
    expect(context.actorUidHash).toBe(shortHash('raw-firebase-user-id'));

    const safe = redactSensitiveData(context);
    expect(safe.actorUid).toBe(REDACTED);
    expect(safe.actorUidHash).toBe(shortHash('raw-firebase-user-id'));
    expect(JSON.stringify(safe)).not.toContain('raw-firebase-user-id');
  });

  it('redacts exact identity keys without hiding safe hash fields', () => {
    const safe = redactSensitiveData({
      uid: 'uid-1',
      driverId: 'driver-1',
      passengerId: 'passenger-1',
      subjectUid: 'subject-1',
      recipientUid: 'recipient-1',
      targetUserId: 'target-1',
      driverIdHash: 'hash-driver',
      actorUidHash: 'hash-actor',
      rideId: 'ride-operational-reference',
    });

    expect(safe).toMatchObject({
      uid: REDACTED,
      driverId: REDACTED,
      passengerId: REDACTED,
      subjectUid: REDACTED,
      recipientUid: REDACTED,
      targetUserId: REDACTED,
      driverIdHash: 'hash-driver',
      actorUidHash: 'hash-actor',
      rideId: 'ride-operational-reference',
    });
  });
});
