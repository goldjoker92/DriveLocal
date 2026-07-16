// Deterministic unit tests for BLOCK 11+12 (minimal admin operations & security).
// In-memory fake Firestore, no emulator/cloud. Covers admin authorization, driver
// suspension/reactivation (active-ride safety), dispute resolution outcomes, and
// wallet adjustments (credit/debit/correction/reversal + invariants).
// Test doubles are TEST-ONLY; runtime uses the Firebase Admin SDK.

const { suspendDriver, reactivateDriver } = require('../drivers/moderateDriver');
const { resolveRideDispute } = require('../rides/disputeResolution');
const { adjustDriverWallet } = require('../wallet/adminWallet');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');
const { AUDIT_LOGS } = require('../config/collections');

const T0 = 1_700_000_000_000;
const ctx = { traceId: 'trace_admin' };

function seedAdmin(db, uid = 'ADM') { db.collection('admins').doc(uid).set({ role: 'admin' }); return uid; }
function seedDriver(db, id, over = {}) {
  db.collection(C.DRIVERS).doc(id).set({
    verificationStatus: 'approved', availabilityStatus: 'online', founderEligible: false,
    walletBalanceCentavos: 5000, walletHeldCentavos: 0, walletAvailableCentavos: 5000, ...over,
  });
}
function seedRide(db, id, over = {}) {
  db.collection(C.RIDE_REQUESTS).doc(id).set({
    rideId: id, passengerId: 'P', acceptedDriverId: 'D', status: C.RIDE_STATUS.DISPUTED,
    estimatedFareCentavos: 2000, estimatedCommissionCentavos: 240, finalCommissionCentavos: 240,
    commissionHoldCentavos: 240, ...over,
  });
}
function adminReq(uid, data) { return { auth: { uid }, data }; }
function get(db, coll, id) { return db._store.get(`${coll}/${id}`); }
function auditCount(db) { let n = 0; for (const k of db._store.keys()) if (k.startsWith(`${AUDIT_LOGS}/`)) n += 1; return n; }

describe('admin authorization', () => {
  it('rejects unauthenticated and non-admin callers on every admin callable', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0);
    seedDriver(db, 'D'); seedRide(db, 'r1');
    const cases = [
      () => suspendDriver({ db, request: { data: { driverId: 'D', reason: 'x' } }, context: ctx, clock }),
      () => reactivateDriver({ db, request: { data: { driverId: 'D' } }, context: ctx, clock }),
      () => resolveRideDispute({ db, request: { data: { rideId: 'r1', outcome: 'retain_for_manual_review', reason: 'x', idempotencyKey: 'k-000000000001' } }, context: ctx, clock }),
      () => adjustDriverWallet({ db, request: { data: { driverId: 'D', operation: 'credit', amountCentavos: 100, reasonCode: 'x', note: 'n', idempotencyKey: 'k-000000000002' } }, context: ctx, clock }),
    ];
    for (const c of cases) await expect(c()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // Signed in but not an admin.
    await expect(suspendDriver({ db, request: adminReq('NOTADMIN', { driverId: 'D', reason: 'x' }), context: ctx, clock }))
      .rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });
});

describe('driver suspension & reactivation', () => {
  it('suspends, clears availability, and is idempotent', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D');
    await suspendDriver({ db, request: adminReq(adm, { driverId: 'D', reason: 'fraude' }), context: ctx, clock });
    const d = get(db, C.DRIVERS, 'D');
    expect(d.verificationStatus).toBe('suspended');
    expect(d.availabilityStatus).toBe('offline');
    const auditsAfterFirst = auditCount(db);
    // Idempotent replay: no second audit, still suspended.
    await suspendDriver({ db, request: adminReq(adm, { driverId: 'D', reason: 'again' }), context: ctx, clock });
    expect(auditCount(db)).toBe(auditsAfterFirst);
  });

  it('rejects suspension during an active ride WITHOUT touching driver/hold state', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { activeRideId: 'r1', walletHeldCentavos: 240, availabilityStatus: 'online' });
    await expect(suspendDriver({ db, request: adminReq(adm, { driverId: 'D', reason: 'x' }), context: ctx, clock }))
      .rejects.toMatchObject({ code: 'RIDE_IN_PROGRESS' });
    const d = get(db, C.DRIVERS, 'D');
    expect(d.verificationStatus).toBe('approved'); // unchanged
    expect(d.availabilityStatus).toBe('online'); // preserved
    expect(d.walletHeldCentavos).toBe(240); // hold preserved
    expect(auditCount(db)).toBe(0);
  });

  it('reactivation restores approved but never sets the driver online; idempotent', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { verificationStatus: 'suspended', availabilityStatus: 'offline', walletBalanceCentavos: 5000 });
    await reactivateDriver({ db, request: adminReq(adm, { driverId: 'D', reason: 'ok' }), context: ctx, clock });
    let d = get(db, C.DRIVERS, 'D');
    expect(d.verificationStatus).toBe('approved');
    expect(d.availabilityStatus).toBe('offline'); // NOT auto-online
    expect(d.walletBalanceCentavos).toBe(5000); // wallet untouched
    const audits = auditCount(db);
    await reactivateDriver({ db, request: adminReq(adm, { driverId: 'D' }), context: ctx, clock });
    expect(auditCount(db)).toBe(audits); // idempotent
  });
});

describe('wallet admin adjustment', () => {
  const base = { reasonCode: 'ajuste', note: 'motivo do ajuste' };
  it('credit increases available+balance; held untouched', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletHeldCentavos: 300 });
    const r = await adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'credit', amountCentavos: 1000, idempotencyKey: 'k-credit-000001', ...base }), context: ctx, clock });
    expect(r.walletAvailableCentavos).toBe(6000);
    expect(r.walletBalanceCentavos).toBe(6000);
    expect(get(db, C.DRIVERS, 'D').walletHeldCentavos).toBe(300);
  });

  it('debit succeeds with funds and is rejected (no change) when insufficient', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletAvailableCentavos: 500, walletBalanceCentavos: 500 });
    await adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'debit', amountCentavos: 200, idempotencyKey: 'k-debit-0000001', ...base }), context: ctx, clock });
    expect(get(db, C.DRIVERS, 'D').walletAvailableCentavos).toBe(300);
    await expect(adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'debit', amountCentavos: 999, idempotencyKey: 'k-debit-0000002', ...base }), context: ctx, clock }))
      .rejects.toMatchObject({ code: 'WALLET_INSUFFICIENT' });
    expect(get(db, C.DRIVERS, 'D').walletAvailableCentavos).toBe(300); // not clamped/changed
  });

  it('duplicate idempotencyKey applies the adjustment exactly once', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletAvailableCentavos: 0, walletBalanceCentavos: 0 });
    const req = adminReq(adm, { driverId: 'D', operation: 'credit', amountCentavos: 700, idempotencyKey: 'k-dup-00000001', ...base });
    await adjustDriverWallet({ db, request: req, context: ctx, clock });
    const r2 = await adjustDriverWallet({ db, request: req, context: ctx, clock });
    expect(r2.replay).toBe(true);
    expect(get(db, C.DRIVERS, 'D').walletAvailableCentavos).toBe(700);
  });

  it('correction writes a NEW compensating entry and preserves the original', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletAvailableCentavos: 1000, walletBalanceCentavos: 1000 });
    await adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'credit', amountCentavos: 500, idempotencyKey: 'k-corr-src-0001', ...base }), context: ctx, clock });
    const original = get(db, C.WALLET_TRANSACTIONS, 'adj_k-corr-src-0001');
    await adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'correction', correctionSign: 'decrease', amountCentavos: 200, idempotencyKey: 'k-corr-fix-0001', ...base }), context: ctx, clock });
    expect(get(db, C.WALLET_TRANSACTIONS, 'adj_k-corr-src-0001')).toEqual(original); // unchanged
    expect(get(db, C.WALLET_TRANSACTIONS, 'adj_k-corr-fix-0001').operation).toBe('correction');
    expect(get(db, C.DRIVERS, 'D').walletAvailableCentavos).toBe(1300);
  });

  it('reversal negates the original, preserves it, and cannot be applied twice', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletAvailableCentavos: 1000, walletBalanceCentavos: 1000 });
    await adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'credit', amountCentavos: 400, idempotencyKey: 'k-rev-src-00001', ...base }), context: ctx, clock });
    const original = get(db, C.WALLET_TRANSACTIONS, 'adj_k-rev-src-00001');
    await adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'reversal', originalLedgerEntryId: 'adj_k-rev-src-00001', idempotencyKey: 'k-rev-do-000001', ...base }), context: ctx, clock });
    expect(get(db, C.DRIVERS, 'D').walletAvailableCentavos).toBe(1000); // back to start
    expect(get(db, C.WALLET_TRANSACTIONS, 'adj_k-rev-src-00001')).toEqual(original); // original immutable
    // Second reversal of the same entry: deterministic id -> replay, no double effect.
    const r = await adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'reversal', originalLedgerEntryId: 'adj_k-rev-src-00001', idempotencyKey: 'k-rev-do-000002', ...base }), context: ctx, clock });
    expect(r.replay).toBe(true);
    expect(get(db, C.DRIVERS, 'D').walletAvailableCentavos).toBe(1000);
  });

  it('rejects reversal of a non-reversible entry', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D');
    db.collection(C.WALLET_TRANSACTIONS).doc('topup_1').set({ type: 'topup', amountCentavos: 1000 }); // no delta / not reversible
    await expect(adjustDriverWallet({ db, request: adminReq(adm, { driverId: 'D', operation: 'reversal', originalLedgerEntryId: 'topup_1', idempotencyKey: 'k-rev-bad-0001', ...base }), context: ctx, clock }))
      .rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
});

describe('ride dispute resolution', () => {
  const rk = (n) => `k-disp-${String(n).padStart(6, '0')}`;
  it('confirm_driver_payment captures commission once and completes; idempotent', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletBalanceCentavos: 5000, walletHeldCentavos: 240, walletAvailableCentavos: 4760 });
    seedRide(db, 'r1');
    const r = await resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'confirm_driver_payment', reason: 'pago', idempotencyKey: rk(1) }), context: ctx, clock });
    expect(r.capturedCommissionCentavos).toBe(240);
    const d = get(db, C.DRIVERS, 'D');
    expect(d.walletBalanceCentavos).toBe(4760);
    expect(d.walletHeldCentavos).toBe(0);
    expect(d.walletAvailableCentavos).toBe(4760);
    expect(get(db, C.RIDE_REQUESTS, 'r1').status).toBe(C.RIDE_STATUS.COMPLETED);
    // Replay -> no second capture.
    const r2 = await resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'confirm_driver_payment', reason: 'pago', idempotencyKey: rk(2) }), context: ctx, clock });
    expect(r2.replay).toBe(true);
    expect(get(db, C.DRIVERS, 'D').walletBalanceCentavos).toBe(4760);
  });

  it('confirm captures ZERO during the commission-free window', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { founderEligible: true, commissionFreeUntil: T0 + 864e5, walletBalanceCentavos: 5000, walletHeldCentavos: 240, walletAvailableCentavos: 4760 });
    seedRide(db, 'r1');
    const r = await resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'confirm_driver_payment', reason: 'pago', idempotencyKey: rk(3) }), context: ctx, clock });
    expect(r.capturedCommissionCentavos).toBe(0);
    const d = get(db, C.DRIVERS, 'D');
    expect(d.walletBalanceCentavos).toBe(5000); // unchanged
    expect(d.walletHeldCentavos).toBe(0);
    expect(d.walletAvailableCentavos).toBe(5000);
  });

  it('release_driver_hold releases the full hold once and cancels the ride', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletHeldCentavos: 240, walletAvailableCentavos: 4760, walletBalanceCentavos: 5000 });
    seedRide(db, 'r1');
    await resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'release_driver_hold', reason: 'sem cobranca', idempotencyKey: rk(4) }), context: ctx, clock });
    const d = get(db, C.DRIVERS, 'D');
    expect(d.walletHeldCentavos).toBe(0);
    expect(d.walletAvailableCentavos).toBe(5000);
    expect(get(db, C.RIDE_REQUESTS, 'r1').status).toBe(C.RIDE_STATUS.CANCELLED);
  });

  it('retain_for_manual_review keeps the hold untouched and is idempotent', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletHeldCentavos: 240 });
    seedRide(db, 'r1');
    await resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'retain_for_manual_review', reason: 'analisar', idempotencyKey: rk(5) }), context: ctx, clock });
    expect(get(db, C.DRIVERS, 'D').walletHeldCentavos).toBe(240);
    expect(get(db, C.RIDE_REQUESTS, 'r1').status).toBe(C.RIDE_STATUS.DISPUTED);
    expect(get(db, C.RIDE_REQUESTS, 'r1').requiresManualReview).toBe(true);
    const r2 = await resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'retain_for_manual_review', reason: 'analisar', idempotencyKey: rk(6) }), context: ctx, clock });
    expect(r2.replay).toBe(true);
  });

  it('rejects a conflicting resolution and creates an audit record on success', async () => {
    const db = makeFakeFirestore(); const clock = fixedClock(T0); const adm = seedAdmin(db);
    seedDriver(db, 'D', { walletHeldCentavos: 240, walletAvailableCentavos: 4760, walletBalanceCentavos: 5000 });
    seedRide(db, 'r1');
    await resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'release_driver_hold', reason: 'ok', idempotencyKey: rk(7) }), context: ctx, clock });
    expect(auditCount(db)).toBeGreaterThan(0);
    // Ride now cancelled; a different (confirm) outcome must be rejected.
    await expect(resolveRideDispute({ db, request: adminReq(adm, { rideId: 'r1', outcome: 'confirm_driver_payment', reason: 'x', idempotencyKey: rk(8) }), context: ctx, clock }))
      .rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
});
