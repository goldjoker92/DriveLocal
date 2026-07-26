jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  shortHash: jest.fn(() => 'actorhash123'),
}));

const { ERROR_CODES } = require('../../errors/appError');
const { fixedClock } = require('../../time/clock');
const { requestAccountDeletion } = require('../requestDeletion');

function snapshot({ exists, data = {}, ref }) {
  return {
    exists,
    data: () => data,
    ref,
  };
}

function createDb({ role = 'driver', profile = {}, rideDocs = [] } = {}) {
  const driverRef = { path: 'drivers/uid1' };
  const passengerRef = { path: 'passengers/uid1' };
  const requestRef = {
    id: 'request_123',
    path: 'accountDeletionRequests/request_123',
    get: jest.fn(async () => snapshot({ exists: false, ref: requestRef })),
  };
  const batch = {
    create: jest.fn(),
    set: jest.fn(),
    commit: jest.fn(async () => undefined),
  };
  const rideQuery = {
    where: jest.fn(() => rideQuery),
    get: jest.fn(async () => ({ docs: rideDocs })),
  };

  const collections = {
    drivers: {
      doc: jest.fn(() => ({
        ...driverRef,
        get: jest.fn(async () => snapshot({
          exists: role === 'driver',
          data: profile,
          ref: driverRef,
        })),
      })),
    },
    passengers: {
      doc: jest.fn(() => ({
        ...passengerRef,
        get: jest.fn(async () => snapshot({
          exists: role === 'passenger',
          data: profile,
          ref: passengerRef,
        })),
      })),
    },
    rideRequests: rideQuery,
    accountDeletionRequests: {
      doc: jest.fn((id) => (id ? {
        id,
        get: jest.fn(async () => snapshot({ exists: false, ref: { id } })),
      } : requestRef)),
    },
  };

  return {
    db: {
      collection: jest.fn((name) => collections[name]),
      batch: jest.fn(() => batch),
    },
    batch,
    requestRef,
    rideQuery,
    driverRef,
    passengerRef,
  };
}

function authenticatedRequest(data = { confirmation: 'EXCLUIR' }) {
  return {
    data,
    auth: {
      uid: 'uid1',
      token: { auth_time: 1000 },
    },
  };
}

describe('requestAccountDeletion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires authentication and recent auth_time', async () => {
    const { db } = createDb();

    await expect(requestAccountDeletion({
      db,
      request: { data: { confirmation: 'EXCLUIR' }, auth: null },
      context: {},
      clock: fixedClock(1_000_000),
    })).rejects.toMatchObject({ code: ERROR_CODES.UNAUTHENTICATED });

    await expect(requestAccountDeletion({
      db,
      request: {
        data: { confirmation: 'EXCLUIR' },
        auth: { uid: 'uid1', token: { auth_time: 1 } },
      },
      context: {},
      clock: fixedClock(1_000_000),
    })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      safeMetadata: { reason: 'RECENT_LOGIN_REQUIRED' },
    });
  });

  it('blocks deletion while the role profile has an active ride', async () => {
    const { db, batch } = createDb({ profile: { activeRideId: 'ride_active' } });

    await expect(requestAccountDeletion({
      db,
      request: authenticatedRequest(),
      context: {},
      clock: fixedClock(1_000_000),
    })).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_STATE_TRANSITION,
      safeMetadata: { reason: 'ACTIVE_RIDE_PRESENT' },
    });

    expect(batch.commit).not.toHaveBeenCalled();
  });

  it('also blocks a stale profile when a non-final ride still references the user', async () => {
    const activeRideDoc = { data: () => ({ status: 'in_progress' }) };
    const { db } = createDb({ profile: {}, rideDocs: [activeRideDoc] });

    await expect(requestAccountDeletion({
      db,
      request: authenticatedRequest(),
      context: {},
      clock: fixedClock(1_000_000),
    })).rejects.toMatchObject({
      safeMetadata: { reason: 'ACTIVE_RIDE_PRESENT' },
    });
  });

  it('creates a private request and freezes driver availability before processing', async () => {
    const { db, batch, requestRef, driverRef } = createDb({
      role: 'driver',
      profile: { activeRideId: null, availabilityStatus: 'online' },
    });

    const result = await requestAccountDeletion({
      db,
      request: authenticatedRequest(),
      context: { traceId: 'trace_request' },
      clock: fixedClock(1_000_000),
    });

    expect(batch.create).toHaveBeenCalledWith(
      requestRef,
      expect.objectContaining({
        subjectUid: 'uid1',
        role: 'driver',
        status: 'requested',
        policyVersion: 'account-deletion-2026.1',
      }),
    );
    expect(batch.set).toHaveBeenCalledWith(
      driverRef,
      expect.objectContaining({
        accountDeletionStatus: 'requested',
        availabilityStatus: 'offline',
        availabilitySessionId: null,
      }),
      { merge: true },
    );
    expect(batch.commit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      accepted: true,
      requestRef: 'request_123',
      status: 'requested',
      replay: false,
    });
  });
});
