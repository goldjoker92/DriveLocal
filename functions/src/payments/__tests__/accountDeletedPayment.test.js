jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

jest.mock('../applyPayment', () => ({
  applyWalletTopup: jest.fn(),
  applySubscription: jest.fn(),
  markManualReview: jest.fn(),
}));

const {
  applyWalletTopup,
  applySubscription,
} = require('../applyPayment');
const { logWarning } = require('../../logging/logger');
const { verifyAndApplyOrder, accountDeletedPayment } = require('../verifyAndApply');
const C = require('../constants');

function createDb(paymentData) {
  const paymentRef = {
    get: jest.fn(async () => ({
      exists: true,
      data: () => paymentData,
    })),
    set: jest.fn(async () => undefined),
  };
  const doc = jest.fn(() => paymentRef);
  const collection = jest.fn(() => ({ doc }));
  return { db: { collection }, paymentRef, collection, doc };
}

describe('deleted account payment barrier', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recognizes both the explicit deletion flag and anonymous driver references', () => {
    expect(accountDeletedPayment({ accountDeleted: true, driverId: 'uid' })).toBe(true);
    expect(accountDeletedPayment({ driverId: 'deleted_driver_random' })).toBe(true);
    expect(accountDeletedPayment({ driverId: 'live_driver_uid' })).toBe(false);
  });

  it('moves a late paid callback to manual review without crediting wallet or subscription', async () => {
    const { db, paymentRef } = createDb({
      driverId: 'deleted_driver_random',
      accountDeleted: true,
      providerOrderId: 'provider_1',
      amountCentavos: 2000,
      purpose: 'wallet_topup',
      status: C.STATUS.CANCELLED,
    });
    const adapter = {
      getOrder: jest.fn(async () => ({
        providerOrderId: 'provider_1',
        externalReference: 'payment_1',
        normalizedStatus: C.STATUS.PAID,
        currency: C.CURRENCY,
        totalAmountCentavos: 2000,
      })),
    };

    const result = await verifyAndApplyOrder({
      db,
      adapter,
      providerOrderId: 'provider_1',
      context: { traceId: 'trace_payment' },
      clock: { now: () => 1_000_000 },
      environment: 'development',
      source: 'webhook',
    });

    expect(result).toMatchObject({
      outcome: 'manual_review',
      event: 'payment.account_deleted_ignored',
      localPaymentId: 'payment_1',
    });
    expect(paymentRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: C.STATUS.MANUAL_REVIEW,
        manualReviewReason: 'account_deleted_provider_payment',
        cancellationReason: 'account_deleted',
      }),
      { merge: true },
    );
    expect(applyWalletTopup).not.toHaveBeenCalled();
    expect(applySubscription).not.toHaveBeenCalled();
    expect(logWarning).toHaveBeenCalledWith(
      expect.any(Object),
      'payment.account_deleted_ignored',
      expect.objectContaining({ outcome: 'manual_review' }),
    );
  });

  it('keeps a non-paid callback cancelled without applying funds', async () => {
    const { db, paymentRef } = createDb({
      driverId: 'deleted_driver_random',
      accountDeleted: true,
      providerOrderId: 'provider_2',
      amountCentavos: 990,
      purpose: 'driver_subscription',
    });
    const adapter = {
      getOrder: jest.fn(async () => ({
        providerOrderId: 'provider_2',
        externalReference: 'payment_2',
        normalizedStatus: C.STATUS.EXPIRED,
        currency: C.CURRENCY,
        totalAmountCentavos: 990,
      })),
    };

    const result = await verifyAndApplyOrder({
      db,
      adapter,
      providerOrderId: 'provider_2',
      context: {},
      clock: { now: () => 1_000_000 },
      environment: 'development',
      source: 'webhook',
    });

    expect(result.outcome).toBe('account_deleted_ignored');
    expect(paymentRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: C.STATUS.CANCELLED,
        cancellationReason: 'account_deleted',
      }),
      { merge: true },
    );
    expect(applyWalletTopup).not.toHaveBeenCalled();
    expect(applySubscription).not.toHaveBeenCalled();
  });
});
