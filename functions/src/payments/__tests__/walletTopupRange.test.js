const {
  createDriverPixPayment,
  validateWalletTopupAmount,
} = require('../createPixPayment');
const { fixedClock } = require('../../time/clock');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

function adapter() {
  const calls = [];
  return {
    calls,
    async createPixOrder(input) {
      calls.push(input);
      return {
        providerOrderId: `mp-${input.localPaymentId}`,
        qrCode: 'qr',
        qrCodeBase64: 'base64',
      };
    },
  };
}

describe('wallet custom top-up range', () => {
  it('accepts known presets without a custom flag', () => {
    expect(validateWalletTopupAmount({ amountCentavos: 1000 })).toEqual({
      amountCentavos: 1000,
      customAmount: false,
    });
    expect(validateWalletTopupAmount({ amountCentavos: 5000, customAmount: false })).toEqual({
      amountCentavos: 5000,
      customAmount: false,
    });
  });

  it('accepts centavo-precise custom values from R$ 10 to R$ 200', () => {
    expect(validateWalletTopupAmount({ amountCentavos: 1000, customAmount: true })).toEqual({
      amountCentavos: 1000,
      customAmount: true,
    });
    expect(validateWalletTopupAmount({ amountCentavos: 1234, customAmount: true })).toEqual({
      amountCentavos: 1234,
      customAmount: true,
    });
    expect(validateWalletTopupAmount({ amountCentavos: 20000, customAmount: true })).toEqual({
      amountCentavos: 20000,
      customAmount: true,
    });
  });

  it.each([
    [{ amountCentavos: 999, customAmount: true }],
    [{ amountCentavos: 20001, customAmount: true }],
    [{ amountCentavos: 1234.5, customAmount: true }],
    [{ amountCentavos: 1234 }],
    [{ amountCentavos: 1234, customAmount: 'yes' }],
  ])('rejects unsupported or malformed payload %j', (payload) => {
    expect(() => validateWalletTopupAmount(payload)).toThrow();
  });

  it('creates one real provider order for an authenticated custom amount', async () => {
    const db = makeFakeFirestore();
    await db.collection('drivers').doc('d1').set({
      verificationStatus: 'approved',
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'moto',
      founderEligible: false,
      commissionFreeUntil: null,
      walletBalanceCentavos: 0,
      walletAvailableCentavos: 0,
      walletHeldCentavos: 0,
    });
    const provider = adapter();

    const result = await createDriverPixPayment({
      db,
      request: {
        auth: { uid: 'd1' },
        data: {
          purpose: 'wallet_topup',
          amountCentavos: 1234,
          customAmount: true,
          idempotencyKey: 'custom-topup-0001',
        },
      },
      context: { traceId: 'trace-custom', environment: 'emulator' },
      clock: fixedClock(NOW),
      adapter: provider,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].amountCentavos).toBe(1234);
    expect(result.amountCentavos).toBe(1234);
    const stored = db._store.get(`paymentRequests/${result.localPaymentId}`);
    expect(stored.customAmount).toBe(true);
    expect(stored.amountCentavos).toBe(1234);
  });
});
