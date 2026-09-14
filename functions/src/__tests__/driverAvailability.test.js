const { setDriverAvailability, WORK_SESSION_MAX_AGE_MS } = require('../drivers/availability');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');

const T0 = 1_800_000_000_000;
const DRIVER_ID = 'driver1';
const ctx = { traceId: 'trace_availability', environment: 'test' };

function seedDriver(db, overrides = {}) {
  db.collection('drivers').doc(DRIVER_ID).set({
    uid: DRIVER_ID,
    serviceAreaId: 'HORIZONTE_CE_BR',
    vehicleType: 'moto',
    verificationStatus: 'approved',
    isBlocked: false,
    activeRideId: null,
    availabilityStatus: 'offline',
    availabilitySessionId: null,
    founderEligible: true,
    commissionFreeUntil: T0 + 60 * 24 * 60 * 60 * 1000,
    subscriptionFreeUntil: T0 + 60 * 24 * 60 * 60 * 1000,
    walletAvailableCentavos: 0,
    ...overrides,
  });
}

function req(availabilityStatus, extra = {}) {
  return {
    auth: { uid: DRIVER_ID },
    data: { availabilityStatus, ...extra },
  };
}

describe('secure driver availability sessions', () => {
  it('rejects unauthenticated changes', async () => {
    const db = makeFakeFirestore();
    seedDriver(db);
    await expect(setDriverAvailability({
      db,
      request: { data: { availabilityStatus: 'online' } },
      context: ctx,
      clock: fixedClock(T0),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('opens a server-owned session and invalidates the previous location session', async () => {
    const db = makeFakeFirestore();
    seedDriver(db, { locationAvailabilitySessionId: 'old_session' });
    const result = await setDriverAvailability({
      db,
      request: req('online'),
      context: ctx,
      clock: fixedClock(T0),
    });

    expect(result.availabilityStatus).toBe('online');
    expect(result.availabilitySessionId).toMatch(/^work_/);
    expect(result.replay).toBe(false);
    const stored = db._store.get(`drivers/${DRIVER_ID}`);
    expect(stored.availabilitySessionId).toBe(result.availabilitySessionId);
    expect(stored.locationAvailabilitySessionId).toBeNull();
    expect(stored.availabilityUpdatedAtMs).toBe(T0);
  });

  it('replays the same fresh session instead of creating another one', async () => {
    const db = makeFakeFirestore();
    seedDriver(db, {
      availabilityStatus: 'online',
      availabilitySessionId: 'work_existing_session_123',
      availabilityUpdatedAtMs: T0 - WORK_SESSION_MAX_AGE_MS + 1,
    });
    const result = await setDriverAvailability({
      db,
      request: req('online'),
      context: ctx,
      clock: fixedClock(T0),
    });
    expect(result.replay).toBe(true);
    expect(result.availabilitySessionId).toBe('work_existing_session_123');
  });

  it('rejects a standard-commission driver whose wallet is not usable', async () => {
    const db = makeFakeFirestore();
    seedDriver(db, {
      founderEligible: false,
      commissionFreeUntil: T0 - 1,
      subscriptionFreeUntil: null,
      subscriptionActive: true,
      subscriptionExpiresAt: T0 + 86400000,
      walletAvailableCentavos: 300,
    });
    await expect(setDriverAvailability({
      db,
      request: req('online'),
      context: ctx,
      clock: fixedClock(T0),
    })).rejects.toMatchObject({ code: 'WALLET_INSUFFICIENT' });
  });

  it('does not let an old client close a newer work session', async () => {
    const db = makeFakeFirestore();
    seedDriver(db, {
      availabilityStatus: 'online',
      availabilitySessionId: 'work_current_session_123',
      availabilityUpdatedAtMs: T0,
    });
    await expect(setDriverAvailability({
      db,
      request: req('offline', { availabilitySessionId: 'work_stale_session_456' }),
      context: ctx,
      clock: fixedClock(T0),
    })).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      safeMetadata: { reason: 'STALE_AVAILABILITY_SESSION' },
    });
  });

  it('preserves an active ride instead of allowing the driver to go offline', async () => {
    const db = makeFakeFirestore();
    seedDriver(db, {
      activeRideId: 'ride1',
      availabilityStatus: 'online',
      availabilitySessionId: 'work_active_ride_123',
    });
    await expect(setDriverAvailability({
      db,
      request: req('offline', { availabilitySessionId: 'work_active_ride_123' }),
      context: ctx,
      clock: fixedClock(T0),
    })).rejects.toMatchObject({ code: 'RIDE_IN_PROGRESS' });
  });

  it('revokes the session when the driver stops working', async () => {
    const db = makeFakeFirestore();
    seedDriver(db, {
      availabilityStatus: 'online',
      availabilitySessionId: 'work_to_close_123456',
      availabilityUpdatedAtMs: T0,
      locationAvailabilitySessionId: 'work_to_close_123456',
    });
    const result = await setDriverAvailability({
      db,
      request: req('offline', { availabilitySessionId: 'work_to_close_123456' }),
      context: ctx,
      clock: fixedClock(T0),
    });
    expect(result.availabilityStatus).toBe('offline');
    expect(result.availabilitySessionId).toBeNull();
    const stored = db._store.get(`drivers/${DRIVER_ID}`);
    expect(stored.locationAvailabilitySessionId).toBeNull();
  });

  it('rejects build 17 online activation when the Pix key is invalid', async () => {
    const db = makeFakeFirestore();
    await db.collection('cityPublicConfig').doc('HORIZONTE_CE_BR').set({
      minimumDriverBuildNumber: 17,
      enforceMinimumDriverBuild: true,
    });
    seedDriver(db, {
      pixKeyType: 'CPF',
      pixKey: '024.995.773-635',
    });

    await expect(setDriverAvailability({
      db,
      request: req('online', { clientBuildNumber: 17, clientVersion: '1.0.12' }),
      context: ctx,
      clock: fixedClock(T0),
    })).rejects.toMatchObject({
      code: 'DRIVER_NOT_ELIGIBLE',
      safeMetadata: { reason: 'PIX_KEY_INVALID' },
    });
  });

  it('accepts and normalizes a valid formatted Pix key during build 17 preflight', async () => {
    const db = makeFakeFirestore();
    await db.collection('cityPublicConfig').doc('HORIZONTE_CE_BR').set({
      minimumDriverBuildNumber: 17,
      enforceMinimumDriverBuild: true,
    });
    seedDriver(db, {
      pixKeyType: 'CPF',
      pixKey: '529.982.247-25',
    });

    const result = await setDriverAvailability({
      db,
      request: req('online', { clientBuildNumber: 17, clientVersion: '1.0.12' }),
      context: ctx,
      clock: fixedClock(T0),
    });
    expect(result.availabilityStatus).toBe('online');
  });

});
