const { getDriverSubscriptionSnapshot } = require('../subscriptionSnapshot');
const { fixedClock } = require('../../time/clock');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

async function seedPayment(db, id, overrides = {}) {
  await db.collection('paymentRequests').doc(id).set({
    driverId: 'd1',
    purpose: 'driver_subscription',
    status: 'pending',
    amountCentavos: 990,
    currency: 'BRL',
    qrCode: 'safe-pix-code',
    qrCodeBase64: 'safe-base64',
    expiresAtMs: NOW + 30 * 60 * 1000,
    createdAtMs: NOW,
    providerOrderId: 'provider-secret',
    idempotencyKey: 'idempotency-secret',
    ...overrides,
  });
}

describe('driver subscription payment snapshot', () => {
  it('rejects unauthenticated restoration', async () => {
    await expect(getDriverSubscriptionSnapshot({
      db: makeFakeFirestore(),
      request: { data: {} },
      context: {},
      clock: fixedClock(NOW),
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('returns only the latest actionable payment owned by the authenticated driver', async () => {
    const db = makeFakeFirestore();
    await seedPayment(db, 'older', { createdAtMs: NOW - 1000, amountCentavos: 1990 });
    await seedPayment(db, 'latest', { createdAtMs: NOW + 1000, status: 'manual_review' });
    await seedPayment(db, 'other-driver', {
      driverId: 'd2',
      createdAtMs: NOW + 2000,
      qrCode: 'must-not-leak',
    });
    await seedPayment(db, 'wallet', {
      purpose: 'wallet_topup',
      createdAtMs: NOW + 3000,
      amountCentavos: 5000,
    });

    const result = await getDriverSubscriptionSnapshot({
      db,
      request: { auth: { uid: 'd1' }, data: {} },
      context: {},
      clock: fixedClock(NOW),
    });

    expect(result.payment).toEqual({
      localPaymentId: 'latest',
      purpose: 'driver_subscription',
      status: 'manual_review',
      amountCentavos: 990,
      currency: 'BRL',
      qrCode: 'safe-pix-code',
      qrCodeBase64: 'safe-base64',
      expiration: NOW + 30 * 60 * 1000,
    });
    expect(result.payment).not.toHaveProperty('providerOrderId');
    expect(result.payment).not.toHaveProperty('idempotencyKey');
    expect(result.payment).not.toHaveProperty('driverId');
  });

  it.each(['paid', 'expired', 'cancelled', 'failed', 'refunded'])(
    'does not reopen a terminal %s payment after restart',
    async (status) => {
      const db = makeFakeFirestore();
      await seedPayment(db, 'terminal', { status });

      const result = await getDriverSubscriptionSnapshot({
        db,
        request: { auth: { uid: 'd1' }, data: {} },
        context: {},
        clock: fixedClock(NOW),
      });

      expect(result.payment).toBeNull();
    }
  );
});
