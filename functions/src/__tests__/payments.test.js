// Deterministic unit tests for the BLOCK 05+06 Mercado Pago Pix payment domain.
// Uses the in-memory fake Firestore and an INJECTED fake provider adapter — no
// emulator, no cloud, no real Mercado Pago call. Exactly the 10 critical
// invariants required by the block.
//
// NOTE: the fake adapter and fakeFirestore are TEST-ONLY. Runtime exports build
// the real adapter (payments/callables.js) — verified separately via git grep.

const { createHmac } = require('crypto');
const { createDriverPixPayment } = require('../payments/createPixPayment');
const { handleWebhook } = require('../payments/webhook');
const { reprocessDriverPayment } = require('../payments/paymentStatus');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../payments/constants');

const T0 = 1_700_000_000_000;
const ENV = 'emulator';
const ctx = { traceId: 'trace_pay', environment: ENV };

function seedDriver(db, id, overrides = {}) {
  db.collection('drivers').doc(id).set({
    serviceAreaId: 'HORIZONTE_CE_BR',
    vehicleType: 'moto',
    walletBalanceCentavos: 0,
    walletAvailableCentavos: 0,
    walletHeldCentavos: 0,
    ...overrides,
  });
}

function seedPayment(db, id, overrides = {}) {
  db.collection(C.PAYMENT_REQUESTS).doc(id).set({
    driverId: 'd1',
    purpose: 'wallet_topup',
    amountCentavos: 2000,
    currency: C.CURRENCY,
    provider: C.PROVIDER,
    providerOrderId: `MP-${id}`,
    externalReference: id,
    status: C.STATUS.PENDING,
    environment: ENV,
    appliedAtMs: null,
    expiresAtMs: T0 + C.ORDER_EXPIRATION_MS,
    ...overrides,
  });
}

// Capturing fake adapter. `orders` maps providerOrderId -> normalized getOrder result.
function makeAdapter(orders = {}) {
  const createCalls = [];
  return {
    createCalls,
    orders,
    async createPixOrder(p) {
      createCalls.push(p);
      return {
        providerOrderId: `MP-${p.localPaymentId}`,
        normalizedStatus: C.STATUS.PENDING,
        qrCode: 'QR_CODE',
        qrCodeBase64: 'QR_BASE64',
        totalAmountCentavos: p.amountCentavos,
        currency: C.CURRENCY,
      };
    },
    async getOrder(providerOrderId) {
      if (!orders[providerOrderId]) throw new Error(`no fake order for ${providerOrderId}`);
      return orders[providerOrderId];
    },
  };
}

// Builds a valid x-signature for a data id using the official manifest.
function signedHeaders(dataId, secret, ts = String(T0)) {
  const xRequestId = 'req-123';
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': xRequestId };
}

const SECRET = 'test_webhook_secret';

function countCollection(db, prefix) {
  let n = 0;
  for (const key of db._store.keys()) if (key.startsWith(`${prefix}/`)) n += 1;
  return n;
}

describe('payments — creation', () => {
  it('T1: unauthenticated payment creation is rejected', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    await expect(
      createDriverPixPayment({
        db,
        request: { data: { purpose: 'wallet_topup', idempotencyKey: 'idem-00000001', amountCentavos: 1000 } },
        context: ctx,
        clock,
        adapter: makeAdapter(),
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('T2: subscription amount is derived server-side from vehicle type', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    // Non-founder, free rides exhausted -> subscription payment is required.
    seedDriver(db, 'moto1', { vehicleType: 'moto', founderEligible: false, freeRideCountUsed: 5 });
    seedDriver(db, 'car1', { vehicleType: 'car', founderEligible: false, freeRideCountUsed: 5 });
    const adapter = makeAdapter();

    await createDriverPixPayment({
      db,
      request: { auth: { uid: 'moto1' }, data: { purpose: 'driver_subscription', idempotencyKey: 'idem-moto-0001' } },
      context: ctx,
      clock,
      adapter,
    });
    await createDriverPixPayment({
      db,
      request: { auth: { uid: 'car1' }, data: { purpose: 'driver_subscription', idempotencyKey: 'idem-car-00001' } },
      context: ctx,
      clock,
      adapter,
    });

    expect(adapter.createCalls[0].amountCentavos).toBe(990); // moto
    expect(adapter.createCalls[1].amountCentavos).toBe(1990); // car
    // Same idempotency key is forwarded to the provider.
    expect(adapter.createCalls[0].idempotencyKey).toBe('idem-moto-0001');
  });

  it('T3: promotions block unnecessary subscription and wallet payments', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    const future = T0 + 30 * 24 * 60 * 60 * 1000;
    // Founder covered by subscriptionFreeUntil + commissionFreeUntil.
    seedDriver(db, 'founder', { founderEligible: true, subscriptionFreeUntil: future, commissionFreeUntil: future });
    // Non-founder still within free rides.
    seedDriver(db, 'newbie', { founderEligible: false, freeRideCountUsed: 2 });
    const adapter = makeAdapter();

    await expect(
      createDriverPixPayment({
        db,
        request: { auth: { uid: 'founder' }, data: { purpose: 'driver_subscription', idempotencyKey: 'idem-f-0000001' } },
        context: ctx,
        clock,
        adapter,
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REQUIRED' });

    await expect(
      createDriverPixPayment({
        db,
        request: { auth: { uid: 'founder' }, data: { purpose: 'wallet_topup', idempotencyKey: 'idem-fw-000001', amountCentavos: 1000 } },
        context: ctx,
        clock,
        adapter,
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REQUIRED' });

    await expect(
      createDriverPixPayment({
        db,
        request: { auth: { uid: 'newbie' }, data: { purpose: 'driver_subscription', idempotencyKey: 'idem-n-0000001' } },
        context: ctx,
        clock,
        adapter,
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_REQUIRED' });

    expect(adapter.createCalls.length).toBe(0); // no provider call for covered drivers
  });

  it('T4: wallet top-up rejects an unsupported amount', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedDriver(db, 'd1', { founderEligible: false, commissionFreeUntil: null });
    const adapter = makeAdapter();

    await expect(
      createDriverPixPayment({
        db,
        request: { auth: { uid: 'd1' }, data: { purpose: 'wallet_topup', idempotencyKey: 'idem-bad-00001', amountCentavos: 1234 } },
        context: ctx,
        clock,
        adapter,
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await expect(
      createDriverPixPayment({
        db,
        request: { auth: { uid: 'd1' }, data: { purpose: 'wallet_topup', idempotencyKey: 'idem-neg-00001', amountCentavos: -1000 } },
        context: ctx,
        clock,
        adapter,
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(adapter.createCalls.length).toBe(0);
  });
});

describe('payments — webhook verification & application', () => {
  it('T5: an invalid webhook signature is rejected (401)', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    const res = await handleWebhook({
      db,
      adapter: makeAdapter(),
      webhookSecret: SECRET,
      clock,
      environment: ENV,
      headers: { 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'req-123' },
      query: {},
      body: { data: { id: 'MP-x' } },
    });
    expect(res.httpStatus).toBe(401);
  });

  it('T6: a refetched amount/reference mismatch never credits (manual_review)', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    seedPayment(db, 'p6', { amountCentavos: 2000, providerOrderId: 'MP-p6' });
    // Provider says PAID but for a DIFFERENT amount.
    const adapter = makeAdapter({
      'MP-p6': {
        providerOrderId: 'MP-p6',
        externalReference: 'p6',
        normalizedStatus: C.STATUS.PAID,
        totalAmountCentavos: 5000,
        currency: C.CURRENCY,
        processingMs: T0,
      },
    });
    const res = await handleWebhook({
      db, adapter, webhookSecret: SECRET, clock, environment: ENV,
      headers: signedHeaders('MP-p6', SECRET), query: {}, body: { data: { id: 'MP-p6' } },
    });
    expect(res.httpStatus).toBe(200);
    expect(res.body.outcome).toBe('manual_review');
    expect(db._store.get('drivers/d1').walletBalanceCentavos).toBe(0); // never credited
    expect(db._store.get('paymentRequests/p6').status).toBe(C.STATUS.MANUAL_REVIEW);
  });

  it('T7: a duplicate webhook credits the wallet exactly once', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    seedPayment(db, 'p7', { amountCentavos: 2000, providerOrderId: 'MP-p7' });
    const adapter = makeAdapter({
      'MP-p7': {
        providerOrderId: 'MP-p7',
        externalReference: 'p7',
        normalizedStatus: C.STATUS.PAID,
        totalAmountCentavos: 2000,
        currency: C.CURRENCY,
        processingMs: T0,
      },
    });
    const call = () =>
      handleWebhook({
        db, adapter, webhookSecret: SECRET, clock, environment: ENV,
        headers: signedHeaders('MP-p7', SECRET), query: {}, body: { data: { id: 'MP-p7' } },
      });
    await call();
    await call();

    expect(db._store.get('drivers/d1').walletBalanceCentavos).toBe(2000);
    expect(db._store.get('drivers/d1').walletAvailableCentavos).toBe(2000);
    expect(db._store.get('drivers/d1').walletHeldCentavos).toBe(0); // untouched
    expect(countCollection(db, C.WALLET_TRANSACTIONS)).toBe(1); // credited once
  });

  it('T8: paid subscription activates once and preserves commissionFreeUntil', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    const commissionFreeUntil = T0 + 999;
    seedDriver(db, 'd1', { vehicleType: 'car', commissionFreeUntil, subscriptionActive: false });
    seedPayment(db, 'p8', { purpose: 'driver_subscription', amountCentavos: 1990, providerOrderId: 'MP-p8' });
    const adapter = makeAdapter({
      'MP-p8': {
        providerOrderId: 'MP-p8',
        externalReference: 'p8',
        normalizedStatus: C.STATUS.PAID,
        totalAmountCentavos: 1990,
        currency: C.CURRENCY,
        processingMs: T0,
      },
    });
    const call = () =>
      handleWebhook({
        db, adapter, webhookSecret: SECRET, clock, environment: ENV,
        headers: signedHeaders('MP-p8', SECRET), query: {}, body: { data: { id: 'MP-p8' } },
      });
    await call();
    const expiryAfterFirst = db._store.get('drivers/d1').subscriptionExpiresAt;
    await call();

    expect(db._store.get('drivers/d1').subscriptionActive).toBe(true);
    expect(db._store.get('drivers/d1').subscriptionExpiresAt).toBe(expiryAfterFirst); // no double-extend
    expect(db._store.get('drivers/d1').commissionFreeUntil).toBe(commissionFreeUntil); // preserved
    expect(countCollection(db, C.SUBSCRIPTION_PAYMENTS)).toBe(1);
  });

  it('T9: a refund after application becomes manual_review (no money removed)', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    seedDriver(db, 'd1');
    seedPayment(db, 'p9', { amountCentavos: 2000, providerOrderId: 'MP-p9' });
    const paid = {
      providerOrderId: 'MP-p9', externalReference: 'p9', normalizedStatus: C.STATUS.PAID,
      totalAmountCentavos: 2000, currency: C.CURRENCY, processingMs: T0,
    };
    const adapter = makeAdapter({ 'MP-p9': paid });
    const call = () =>
      handleWebhook({
        db, adapter, webhookSecret: SECRET, clock, environment: ENV,
        headers: signedHeaders('MP-p9', SECRET), query: {}, body: { data: { id: 'MP-p9' } },
      });
    await call(); // credited
    expect(db._store.get('drivers/d1').walletBalanceCentavos).toBe(2000);
    // Now provider reports a refund.
    adapter.orders['MP-p9'] = { ...paid, normalizedStatus: C.STATUS.REFUNDED };
    const res = await call();

    expect(res.body.outcome).toBe('manual_review');
    expect(db._store.get('drivers/d1').walletBalanceCentavos).toBe(2000); // never subtracted
    expect(db._store.get('paymentRequests/p9').status).toBe(C.STATUS.MANUAL_REVIEW);
  });

  it('T10: admin reprocessing is authorized and idempotent', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(T0);
    db.collection('admins').doc('admin1').set({ role: 'admin' });
    seedDriver(db, 'd1');
    seedPayment(db, 'p10', { amountCentavos: 3000, providerOrderId: 'MP-p10' });
    const adapter = makeAdapter({
      'MP-p10': {
        providerOrderId: 'MP-p10', externalReference: 'p10', normalizedStatus: C.STATUS.PAID,
        totalAmountCentavos: 3000, currency: C.CURRENCY, processingMs: T0,
      },
    });

    // Unauthenticated / non-admin rejected.
    await expect(
      reprocessDriverPayment({ db, request: { data: { localPaymentId: 'p10' } }, context: ctx, clock, adapter, environment: ENV })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      reprocessDriverPayment({ db, request: { auth: { uid: 'x' }, data: { localPaymentId: 'p10' } }, context: ctx, clock, adapter, environment: ENV })
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });

    const adminReq = { auth: { uid: 'admin1' }, data: { localPaymentId: 'p10' } };
    const first = await reprocessDriverPayment({ db, request: adminReq, context: ctx, clock, adapter, environment: ENV });
    const second = await reprocessDriverPayment({ db, request: adminReq, context: ctx, clock, adapter, environment: ENV });

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('duplicate');
    expect(db._store.get('drivers/d1').walletBalanceCentavos).toBe(3000); // credited once
    expect(countCollection(db, C.WALLET_TRANSACTIONS)).toBe(1);
  });
});
