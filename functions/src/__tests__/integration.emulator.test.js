// Integration safety tests. The guard tests ALWAYS run (they prove we fail
// closed without the emulator). The real-Firestore tests run ONLY when
// FIRESTORE_EMULATOR_HOST is set — they must never touch cloud Firestore.

const { assertEmulator, isEmulatorConfigured } = require('../config/emulatorGuard');

describe('emulator guard (fail closed)', () => {
  it('refuses to run integration code when the emulator host is missing', () => {
    expect(() => assertEmulator({})).toThrow(/EMULATOR_REQUIRED/);
  });
  it('detects an explicitly configured emulator host', () => {
    expect(isEmulatorConfigured({})).toBe(false);
    expect(isEmulatorConfigured({ FIRESTORE_EMULATOR_HOST: 'localhost:8080' })).toBe(true);
  });
});

// Only runs under the emulator; skipped in the default deterministic suite.
const itEmulator = process.env.FIRESTORE_EMULATOR_HOST ? it : it.skip;

describe('idempotency against the Firestore emulator', () => {
  itEmulator('acquires once and replays the completed result', async () => {
    const admin = require('firebase-admin');
    if (admin.apps.length === 0) admin.initializeApp({ projectId: 'drivelocal-dev' });
    const db = admin.firestore();
    const { acquireOperation, completeOperation, OPERATION_STATES } = require('../idempotency/idempotency');
    const { systemClock } = require('../time/clock');

    const params = {
      idempotencyKey: `emu-${Date.now()}`,
      operationType: 'wallet_topup',
      actorUid: 'driverEmu',
      traceId: 'trace_emu',
      payload: { amountCentavos: 1000 },
    };
    const first = await acquireOperation(db, params, systemClock);
    expect(first.acquired).toBe(true);
    await completeOperation(db, params.idempotencyKey, 'walletTransactions/emu', systemClock);
    const replay = await acquireOperation(db, params, systemClock);
    expect(replay.acquired).toBe(false);
    expect(replay.state).toBe(OPERATION_STATES.COMPLETED);
    expect(replay.resultReference).toBe('walletTransactions/emu');
  });
});
