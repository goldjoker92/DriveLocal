// Deterministic unit tests for the BLOCK 03 secure driver domain.
// Uses the existing in-memory fake Firestore and an injected fixed clock — no
// emulator, no cloud. Exactly the 8 critical invariants required by the block.

const { approveDriver } = require('../drivers/approveDriver');
const { rejectDriver, blockDriver, unblockDriver } = require('../drivers/moderateDriver');
const { activateSubscription } = require('../drivers/activateSubscription');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../drivers/constants');

const ADMIN = 'admin1';
const T0 = 1_000_000; // fixed base epoch ms

function seedAdmin(db) {
  db.collection('admins').doc(ADMIN).set({ role: 'admin' });
}

function seedDriver(db, id, overrides = {}) {
  db.collection('drivers')
    .doc(id)
    .set({ serviceAreaId: 'HORIZONTE_CE_BR', vehicleType: 'moto', ...overrides });
}

function adminReq(data) {
  return { auth: { uid: ADMIN }, data };
}
const ctx = { traceId: 'trace_test' };

function countAudits(db) {
  let n = 0;
  for (const key of db._store.keys()) if (key.startsWith('auditLogs/')) n += 1;
  return n;
}

describe('secure driver domain — approval / founder', () => {
  it('T1: founder positions 1 and 100, non-founder 101 (one city)', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    let first;
    let hundredth;
    let hundredFirst;
    for (let i = 1; i <= 101; i += 1) {
      seedDriver(db, `d${i}`);
      const r = await approveDriver({ db, request: adminReq({ driverId: `d${i}` }), context: ctx, clock });
      if (i === 1) first = r;
      if (i === 100) hundredth = r;
      if (i === 101) hundredFirst = r;
    }
    expect(first).toMatchObject({ approvalNumber: 1, founderEligible: true, founderNumber: 1 });
    expect(hundredth).toMatchObject({ approvalNumber: 100, founderEligible: true, founderNumber: 100 });
    expect(hundredFirst).toMatchObject({ approvalNumber: 101, founderEligible: false, founderNumber: null });
    expect(hundredFirst.commissionFreeUntil).toBeNull();
    expect(hundredFirst.subscriptionFreeUntil).toBeNull();
  });

  it('T2: moto and car share one city counter; different cities are independent', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    seedDriver(db, 'ha_moto', { serviceAreaId: 'CITY_A', vehicleType: 'moto' });
    seedDriver(db, 'ha_car', { serviceAreaId: 'CITY_A', vehicleType: 'car' });
    seedDriver(db, 'hb_moto', { serviceAreaId: 'CITY_B', vehicleType: 'moto' });

    const aMoto = await approveDriver({ db, request: adminReq({ driverId: 'ha_moto' }), context: ctx, clock });
    const aCar = await approveDriver({ db, request: adminReq({ driverId: 'ha_car' }), context: ctx, clock });
    const bMoto = await approveDriver({ db, request: adminReq({ driverId: 'hb_moto' }), context: ctx, clock });

    expect(aMoto.approvalNumber).toBe(1);
    expect(aCar.approvalNumber).toBe(2); // shared A counter across vehicle types
    expect(bMoto.approvalNumber).toBe(1); // independent B counter
  });

  it('T3: repeated approval does not increment the counter twice', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    await approveDriver({ db, request: adminReq({ driverId: 'd1' }), context: ctx, clock });
    clock.advance(5_000);
    const second = await approveDriver({ db, request: adminReq({ driverId: 'd1' }), context: ctx, clock });

    expect(second.approvalNumber).toBe(1);
    expect(db._store.get('counters/HORIZONTE_CE_BR').approvedCount).toBe(1);
    // Only the first approval writes an audit record.
    expect(countAudits(db)).toBe(1);
  });

  it('T4: reapproval preserves approvedAt, founderNumber and benefit dates', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    const first = await approveDriver({ db, request: adminReq({ driverId: 'd1' }), context: ctx, clock });
    clock.advance(10 * C.DAY_MS);
    const second = await approveDriver({ db, request: adminReq({ driverId: 'd1' }), context: ctx, clock });

    expect(second.approvedAtMs).toBe(first.approvedAtMs);
    expect(second.founderNumber).toBe(first.founderNumber);
    expect(second.commissionFreeUntil).toBe(first.commissionFreeUntil);
    expect(second.subscriptionFreeUntil).toBe(first.subscriptionFreeUntil);
    expect(first.commissionFreeUntil).toBe(T0 + C.FREE_PERIOD_DAYS * C.DAY_MS);
  });
});

describe('secure driver domain — authorization & moderation', () => {
  it('T5: unauthorized callers are rejected', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    await expect(
      approveDriver({ db, request: { data: { driverId: 'd1' } }, context: ctx, clock })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      approveDriver({ db, request: { auth: { uid: 'not_admin' }, data: { driverId: 'd1' } }, context: ctx, clock })
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
  });

  it('T6: reject/block/unblock require admin + reason and never reset approval/founder', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    const approved = await approveDriver({ db, request: adminReq({ driverId: 'd1' }), context: ctx, clock });

    // Missing reason -> INVALID_ARGUMENT.
    await expect(
      blockDriver({ db, request: adminReq({ driverId: 'd1' }), context: ctx, clock })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    // Non-admin -> ADMIN_REQUIRED.
    await expect(
      blockDriver({ db, request: { auth: { uid: 'x' }, data: { driverId: 'd1', reason: 'r' } }, context: ctx, clock })
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });

    const blocked = await blockDriver({ db, request: adminReq({ driverId: 'd1', reason: 'fraude' }), context: ctx, clock });
    expect(blocked.isBlocked).toBe(true);
    const unblocked = await unblockDriver({ db, request: adminReq({ driverId: 'd1', reason: 'revisado' }), context: ctx, clock });
    expect(unblocked.isBlocked).toBe(false);
    const rejected = await rejectDriver({ db, request: adminReq({ driverId: 'd1', reason: 'doc invalido' }), context: ctx, clock });

    // Moderation never wipes approval/founder history.
    expect(rejected.verificationStatus).toBe('rejected');
    expect(rejected.approvedAtMs).toBe(approved.approvedAtMs);
    expect(rejected.founderNumber).toBe(approved.founderNumber);
  });
});

describe('secure driver domain — manual subscription', () => {
  it('T7: renewal extends from expiry, expired starts from now, price is fixed by vehicle', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    // Active moto subscription -> extend from current expiry.
    seedDriver(db, 'act', {
      vehicleType: 'moto',
      subscriptionActive: true,
      subscriptionExpiresAt: T0 + 10 * C.DAY_MS,
    });
    const renew = await activateSubscription({
      db,
      request: adminReq({ driverId: 'act', idempotencyKey: 'sub-renew-000001' }),
      context: ctx,
      clock,
    });
    expect(renew.priceCentavos).toBe(C.MOTO_SUBSCRIPTION_CENTAVOS);
    expect(renew.subscriptionExpiresAt).toBe(T0 + 10 * C.DAY_MS + C.SUBSCRIPTION_DURATION_DAYS * C.DAY_MS);
    expect(renew.extendedFromActive).toBe(true);

    // Expired car subscription -> start from now, car price.
    seedDriver(db, 'exp', {
      vehicleType: 'car',
      subscriptionActive: true,
      subscriptionExpiresAt: T0 - C.DAY_MS,
    });
    const fresh = await activateSubscription({
      db,
      request: adminReq({ driverId: 'exp', idempotencyKey: 'sub-fresh-000001' }),
      context: ctx,
      clock,
    });
    expect(fresh.priceCentavos).toBe(C.CAR_SUBSCRIPTION_CENTAVOS);
    expect(fresh.subscriptionExpiresAt).toBe(T0 + C.SUBSCRIPTION_DURATION_DAYS * C.DAY_MS);
    expect(fresh.extendedFromActive).toBe(false);
  });

  it('T8: subscription idempotency — single audit, no double-extend, commissionFreeUntil unchanged', async () => {
    const db = makeFakeFirestore();
    seedAdmin(db);
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    await approveDriver({ db, request: adminReq({ driverId: 'd1' }), context: ctx, clock });
    const commissionBefore = db._store.get('drivers/d1').commissionFreeUntil;
    const auditsAfterApproval = countAudits(db);

    const key = 'sub-idem-000001';
    const first = await activateSubscription({
      db,
      request: adminReq({ driverId: 'd1', idempotencyKey: key }),
      context: ctx,
      clock,
    });
    const replay = await activateSubscription({
      db,
      request: adminReq({ driverId: 'd1', idempotencyKey: key }),
      context: ctx,
      clock,
    });

    expect(replay.subscriptionExpiresAt).toBe(first.subscriptionExpiresAt); // no double extend
    expect(countAudits(db)).toBe(auditsAfterApproval + 1); // exactly one activation audit
    expect(db._store.get('drivers/d1').commissionFreeUntil).toBe(commissionBefore); // untouched
    expect(db._store.get('drivers/d1').subscriptionPaymentMode).toBe('manual_admin');
  });
});
