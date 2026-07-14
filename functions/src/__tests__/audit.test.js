const { writeAuditLog } = require('../audit/auditLog');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');

const clock = fixedClock(2_000);

function validEntry(overrides = {}) {
  return {
    actorUid: 'admin1',
    actorType: 'admin',
    action: 'driver_approved',
    targetType: 'driver',
    targetId: 'driver1',
    ...overrides,
  };
}

describe('writeAuditLog', () => {
  it('writes an immutable record with a server-generated id and server timestamp', async () => {
    const db = makeFakeFirestore();
    const id = await writeAuditLog(db, validEntry(), clock);
    expect(typeof id).toBe('string');
    const record = db._store.get(`auditLogs/${id}`);
    expect(record.action).toBe('driver_approved');
    expect(record.createdAtMs).toBe(2000);
    expect(record.createdAt).toBeDefined(); // server timestamp sentinel
  });

  it('redacts before/after summaries and does not mutate the input', async () => {
    const db = makeFakeFirestore();
    const beforeSummary = { cpf: '123.456.789-00', vehicleType: 'moto' };
    const snapshot = JSON.stringify(beforeSummary);
    const id = await writeAuditLog(db, validEntry({ beforeSummary }), clock);
    const record = db._store.get(`auditLogs/${id}`);
    expect(record.beforeSummary.cpf).toBe('[REDACTED]');
    expect(record.beforeSummary.vehicleType).toBe('moto');
    expect(JSON.stringify(beforeSummary)).toBe(snapshot); // input unchanged
  });

  it('rejects a missing mandatory field (fail closed)', async () => {
    const db = makeFakeFirestore();
    await expect(writeAuditLog(db, validEntry({ actorUid: '' }), clock)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('requires a reason for reason-required actions', async () => {
    const db = makeFakeFirestore();
    await expect(
      writeAuditLog(db, validEntry({ action: 'wallet_manual_adjustment' }), clock)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    // With a reason it succeeds.
    const id = await writeAuditLog(
      db,
      validEntry({ action: 'wallet_manual_adjustment', reason: 'correction after Pix proof' }),
      clock
    );
    expect(typeof id).toBe('string');
  });
});
