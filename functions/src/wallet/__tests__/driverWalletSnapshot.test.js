const { getDriverWalletSnapshot } = require('../driverWalletSnapshot');
const { fixedClock } = require('../../time/clock');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

async function seed(db, collection, id, data) {
  await db.collection(collection).doc(id).set(data);
}

describe('driver wallet safe snapshot', () => {
  it('rejects unauthenticated reads', async () => {
    await expect(getDriverWalletSnapshot({
      db: makeFakeFirestore(),
      request: { data: {} },
      context: {},
      clock: fixedClock(NOW),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns real balances, private history projection and commission-free lock', async () => {
    const db = makeFakeFirestore();
    await seed(db, 'drivers', 'd1', {
      verificationStatus: 'approved',
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'moto',
      approvedAtMs: NOW - 10 * DAY_MS,
      commissionFreeUntil: NOW + 50 * DAY_MS,
      walletBalanceCentavos: 7500,
      walletAvailableCentavos: 7000,
      walletHeldCentavos: 500,
      walletLedgerVersion: 'v1',
    });
    await seed(db, 'walletTransactions', 'hold1', {
      driverId: 'd1',
      rideId: 'ride1',
      type: 'commission_hold',
      status: 'held',
      amountCentavos: 500,
      createdAtMs: NOW - 1000,
      traceId: 'must-not-leak',
      note: 'private admin note',
      adminUid: 'admin-private',
    });
    await seed(db, 'walletTransactions', 'topup1', {
      driverId: 'd1',
      type: 'topup',
      status: 'paid',
      amountCentavos: 5000,
      paymentId: 'pay1',
      balanceAfterCentavos: 7500,
      createdAtMs: NOW,
      providerOrderId: 'secret-provider-id',
    });
    await seed(db, 'walletTransactions', 'other', {
      driverId: 'd2',
      type: 'topup',
      amountCentavos: 9999,
      createdAtMs: NOW + 1,
    });
    await seed(db, 'paymentRequests', 'pay1', {
      driverId: 'd1',
      purpose: 'wallet_topup',
      status: 'paid',
      amountCentavos: 5000,
      createdAtMs: NOW,
      appliedAtMs: NOW,
      providerOrderId: 'secret-provider-id',
      idempotencyKey: 'secret-idempotency',
      qrCode: 'private-qr',
    });
    await seed(db, 'paymentRequests', 'sub1', {
      driverId: 'd1',
      purpose: 'driver_subscription',
      status: 'paid',
      amountCentavos: 990,
      createdAtMs: NOW + 2,
    });

    const view = await getDriverWalletSnapshot({
      db,
      request: { auth: { uid: 'd1' }, data: {} },
      context: { traceId: 'trace-wallet' },
      clock: fixedClock(NOW),
    });

    expect(view.wallet).toEqual({
      balanceCentavos: 7500,
      availableCentavos: 7000,
      heldCentavos: 500,
      ledgerVersion: 'v1',
    });
    expect(view.topupPolicy).toMatchObject({
      locked: true,
      unlockAtMs: NOW + 50 * DAY_MS,
      minCentavos: 1000,
      maxCentavos: 20000,
      presetCentavos: [1000, 2000, 3000, 5000],
    });
    expect(view.transactions.map((item) => item.id)).toEqual(['topup1', 'hold1']);
    expect(view.payments).toHaveLength(1);
    expect(view.payments[0]).toMatchObject({
      localPaymentId: 'pay1',
      purpose: 'wallet_topup',
      status: 'paid',
      amountCentavos: 5000,
    });
    expect(view.transactions[0]).not.toHaveProperty('providerOrderId');
    expect(view.transactions[0]).not.toHaveProperty('traceId');
    expect(view.transactions[0]).not.toHaveProperty('adminUid');
    expect(view.transactions[0]).not.toHaveProperty('note');
    expect(view.payments[0]).not.toHaveProperty('idempotencyKey');
    expect(view.payments[0]).not.toHaveProperty('qrCode');
  });

  it('keeps missing wallet fields null instead of inventing a zero balance', async () => {
    const db = makeFakeFirestore();
    await seed(db, 'drivers', 'd1', {
      verificationStatus: 'approved',
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'car',
      commissionFreeUntil: null,
    });

    const view = await getDriverWalletSnapshot({
      db,
      request: { auth: { uid: 'd1' }, data: {} },
      context: {},
      clock: fixedClock(NOW),
    });

    expect(view.wallet.balanceCentavos).toBeNull();
    expect(view.wallet.availableCentavos).toBeNull();
    expect(view.wallet.heldCentavos).toBeNull();
    expect(view.topupPolicy.locked).toBe(false);
  });
});
