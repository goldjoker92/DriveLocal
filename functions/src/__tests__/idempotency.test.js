const {
  fingerprintPayload,
  acquireOperation,
  completeOperation,
  OPERATION_STATES,
} = require('../idempotency/idempotency');
const { AppError } = require('../errors/appError');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');

describe('idempotency fingerprint', () => {
  it('is deterministic and independent of property order', () => {
    expect(fingerprintPayload({ a: 1, b: 2 })).toBe(fingerprintPayload({ b: 2, a: 1 }));
  });
  it('differs for different payloads', () => {
    expect(fingerprintPayload({ amount: 1000 })).not.toBe(fingerprintPayload({ amount: 2000 }));
  });
  it('never includes secret fields in the fingerprint source', () => {
    const base = { amount: 1000 };
    const withSecretA = { amount: 1000, accessToken: 'A' };
    const withSecretB = { amount: 1000, accessToken: 'B' };
    expect(fingerprintPayload(withSecretA)).toBe(fingerprintPayload(withSecretB));
    expect(fingerprintPayload(withSecretA)).toBe(fingerprintPayload(base));
  });
});

describe('idempotency acquire/complete', () => {
  const clock = fixedClock(1_000);
  const params = {
    idempotencyKey: 'DL-TOPUP-000001',
    operationType: 'wallet_topup',
    actorUid: 'driver1',
    traceId: 'trace_x',
    payload: { amountCentavos: 1000 },
  };

  it('acquires a new operation (started) and records it', async () => {
    const db = makeFakeFirestore();
    const res = await acquireOperation(db, params, clock);
    expect(res).toEqual({ acquired: true, state: OPERATION_STATES.STARTED });
    expect(db._store.get('idempotencyOperations/DL-TOPUP-000001').state).toBe(OPERATION_STATES.STARTED);
  });

  it('replays a completed operation with the same payload', async () => {
    const db = makeFakeFirestore();
    await acquireOperation(db, params, clock);
    await completeOperation(db, params.idempotencyKey, 'walletTransactions/tx1', clock);
    const res = await acquireOperation(db, params, clock);
    expect(res.acquired).toBe(false);
    expect(res.state).toBe(OPERATION_STATES.COMPLETED);
    expect(res.resultReference).toBe('walletTransactions/tx1');
  });

  it('throws IDEMPOTENCY_CONFLICT for the same key with a different payload', async () => {
    const db = makeFakeFirestore();
    await acquireOperation(db, params, clock);
    const conflicting = { ...params, payload: { amountCentavos: 9999 } };
    await expect(acquireOperation(db, conflicting, clock)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(acquireOperation(db, conflicting, clock)).rejects.toBeInstanceOf(AppError);
  });

  it('reports in-progress when re-acquired before completion', async () => {
    const db = makeFakeFirestore();
    await acquireOperation(db, params, clock);
    const res = await acquireOperation(db, params, clock);
    expect(res).toEqual({ acquired: false, state: OPERATION_STATES.STARTED });
  });
});
