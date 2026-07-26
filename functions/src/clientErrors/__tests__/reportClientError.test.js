jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  shortHash: jest.fn(() => 'actorhash123'),
  logWarning: jest.fn(),
}));

const { AppError, ERROR_CODES } = require('../../errors/appError');
const { logWarning } = require('../../logging/logger');
const { reportClientError } = require('../reportClientError');
const { fixedClock } = require('../../time/clock');

function createDb(existingData = null) {
  const reportRef = { path: 'clientErrorReports/report1' };
  const tx = {
    get: jest.fn(async () => ({
      exists: existingData != null,
      data: () => existingData || {},
    })),
    create: jest.fn(),
    set: jest.fn(),
  };
  const doc = jest.fn(() => reportRef);
  const collection = jest.fn(() => ({ doc }));
  const runTransaction = jest.fn(async (callback) => callback(tx));

  return {
    db: { collection, runTransaction },
    tx,
    collection,
    doc,
    reportRef,
  };
}

const SAFE_PAYLOAD = {
  eventName: 'react.render_failed',
  severity: 'fatal',
  source: 'react_boundary',
  isFatal: true,
  errorName: 'TypeError',
  message: 'Cannot read status for person@example.com',
  stack: 'TypeError: Cannot read status\n at DriverHome:42',
  route: '/driver-home?uid=raw',
  role: 'driver',
  rideRef: 'ride_1…abcd',
  appVersion: '1.0.0',
  environment: 'development',
  platform: 'android',
  occurredAtMs: 1_000_000,
};

describe('reportClientError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires an authenticated user', async () => {
    const { db } = createDb();

    await expect(reportClientError({
      db,
      request: { data: SAFE_PAYLOAD, auth: null },
      context: {},
      clock: fixedClock(1_000_000),
    })).rejects.toMatchObject({
      name: 'AppError',
      code: ERROR_CODES.UNAUTHENTICATED,
    });
  });

  it('creates one private sanitized report document', async () => {
    const { db, tx, collection, doc } = createDb();
    const result = await reportClientError({
      db,
      request: { data: SAFE_PAYLOAD, auth: { uid: 'driver-secret-uid' } },
      context: { traceId: 'server-trace', actorUid: 'driver-secret-uid' },
      clock: fixedClock(1_000_000),
    });

    expect(collection).toHaveBeenCalledWith('clientErrorReports');
    expect(doc).toHaveBeenCalledWith(expect.stringMatching(/^cer_actorhash123_/));
    expect(tx.create).toHaveBeenCalledTimes(1);
    expect(tx.set).not.toHaveBeenCalled();

    const written = tx.create.mock.calls[0][1];
    expect(written.actorUid).toBe('driver-secret-uid');
    expect(written.message).not.toContain('person@example.com');
    expect(written.route).toBe('/driver-home');
    expect(written.occurrenceCount).toBe(1);
    expect(written.status).toBe('open');
    expect(result).toMatchObject({ accepted: true });

    expect(logWarning).toHaveBeenCalledTimes(1);
    const loggedContext = logWarning.mock.calls[0][0];
    const loggedExtra = logWarning.mock.calls[0][2];
    expect(loggedContext.actorUid).toBeUndefined();
    expect(loggedContext.actorHash).toBe('actorhash123');
    expect(loggedExtra).not.toHaveProperty('message');
    expect(loggedExtra).not.toHaveProperty('stack');
  });

  it('increments an existing fingerprint bucket instead of creating a new document', async () => {
    const { db, tx } = createDb({ occurrenceCount: 4 });

    await reportClientError({
      db,
      request: { data: SAFE_PAYLOAD, auth: { uid: 'driver-secret-uid' } },
      context: {},
      clock: fixedClock(1_000_000),
    });

    expect(tx.create).not.toHaveBeenCalled();
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(tx.set.mock.calls[0][1]).toMatchObject({
      occurrenceCount: 5,
      lastSeenAtMs: 1_000_000,
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(tx.set.mock.calls[0][2]).toEqual({ merge: true });
  });
});
