jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      delete: () => 'DELETE_FIELD',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  shortHash: jest.fn(),
}));

jest.mock('../../audit/auditLog', () => ({ writeAuditLog: jest.fn() }));

const { latestDriverPayment } = require('../tickets');

function dbWithPayments(rows) {
  const clauses = [];

  function builder() {
    return {
      where: jest.fn((field, operator, value) => {
        clauses.push({ type: 'where', field, operator, value });
        return builder();
      }),
      orderBy: jest.fn((field, direction) => {
        clauses.push({ type: 'orderBy', field, direction });
        return builder();
      }),
      limit: jest.fn((max) => {
        clauses.push({ type: 'limit', max });
        return builder();
      }),
      get: jest.fn(async () => {
        expect(clauses).toEqual([
          { type: 'where', field: 'driverId', operator: '==', value: 'driver-1' },
          { type: 'where', field: 'purpose', operator: '==', value: 'wallet_topup' },
          { type: 'orderBy', field: 'createdAtMs', direction: 'desc' },
          { type: 'limit', max: 1 },
        ]);
        const selected = rows
          .filter((row) => (
            row.data.driverId === 'driver-1'
            && row.data.purpose === 'wallet_topup'
          ))
          .sort((left, right) => right.data.createdAtMs - left.data.createdAtMs)
          .slice(0, 1);
        return {
          docs: selected.map((row) => ({
            id: row.id,
            data: () => row.data,
          })),
        };
      }),
    };
  }

  return {
    collection: jest.fn((collectionName) => {
      expect(collectionName).toBe('paymentRequests');
      return builder();
    }),
  };
}

describe('support payment context', () => {
  it('selects the newest payment matching the requested purpose', async () => {
    const db = dbWithPayments([
      {
        id: 'wallet-old',
        data: {
          driverId: 'driver-1',
          purpose: 'wallet_topup',
          status: 'failed',
          amountCentavos: 1000,
          provider: 'mercado_pago',
          providerOrderId: 'provider-old',
          createdAtMs: 100,
        },
      },
      {
        id: 'subscription-newer',
        data: {
          driverId: 'driver-1',
          purpose: 'driver_subscription',
          status: 'paid',
          amountCentavos: 1990,
          providerOrderId: 'provider-subscription',
          createdAtMs: 500,
        },
      },
      {
        id: 'wallet-new',
        data: {
          driverId: 'driver-1',
          purpose: 'wallet_topup',
          status: 'pending',
          amountCentavos: 3000,
          provider: 'mercado_pago',
          providerOrderId: 'provider-new',
          createdAtMs: 300,
          expiresAtMs: 900,
          qrCode: 'PRIVATE_QR',
          qrCodeBase64: 'PRIVATE_QR_IMAGE',
          idempotencyKey: 'PRIVATE_KEY',
        },
      },
    ]);

    const result = await latestDriverPayment(db, 'driver-1', 'wallet_topup');

    expect(result).toEqual({
      paymentRequestId: 'wallet-new',
      purpose: 'wallet_topup',
      status: 'pending',
      amountCentavos: 3000,
      provider: 'mercado_pago',
      providerOrderId: 'provider-new',
      createdAtMs: 300,
      expiresAtMs: 900,
    });
    expect(result).not.toHaveProperty('qrCode');
    expect(result).not.toHaveProperty('qrCodeBase64');
    expect(result).not.toHaveProperty('idempotencyKey');
  });

  it('returns null when the category does not require payment context', async () => {
    const db = { collection: jest.fn() };
    await expect(latestDriverPayment(db, 'driver-1', null)).resolves.toBeNull();
    expect(db.collection).not.toHaveBeenCalled();
  });
});