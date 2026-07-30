const {
  normalizeCpf,
  buildDriverPayer,
  buildOrderItem,
  buildAdditionalInfo,
  normalizeDeviceSessionId,
} = require('../orderQualityData');
const { createMercadoPagoAdapter } = require('../mercadoPago');

describe('Mercado Pago MVP quality data', () => {
  test('normalizes a valid driver CPF and rejects invalid values', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeCpf('111.111.111-11')).toBeNull();
    expect(normalizeCpf('123')).toBeNull();
  });

  test('builds payer only from the authenticated driver profile', () => {
    const payer = buildDriverPayer({
      driver: {
        email: ' MOTORISTA@EXAMPLE.COM ',
        fullName: 'Carlos da Silva',
        cpf: '529.982.247-25',
      },
      authToken: { email: 'fallback@example.com' },
    });

    expect(payer).toEqual({
      email: 'motorista@example.com',
      first_name: 'Carlos',
      last_name: 'da Silva',
      identification: { type: 'CPF', number: '52998224725' },
    });
  });

  test('omits an invalid CPF rather than sending unverified identification', () => {
    const payer = buildDriverPayer({
      driver: { email: 'driver@example.com', fullName: 'Ana', cpf: '00000000000' },
    });
    expect(payer).toEqual({ email: 'driver@example.com', first_name: 'Ana' });
  });

  test('builds one correctly-priced digital item per payment purpose', () => {
    expect(buildOrderItem({
      purpose: 'wallet_topup',
      vehicleType: 'moto',
      amountCentavos: 2000,
    })).toEqual({
      title: 'Recarga Saldo DriveLocal',
      description: 'Recarga digital do saldo operacional do motorista parceiro',
      category_id: 'services',
      quantity: 1,
      unit_price: '20.00',
      external_code: 'driver_wallet_topup',
    });

    expect(buildOrderItem({
      purpose: 'driver_subscription',
      vehicleType: 'car',
      amountCentavos: 1990,
    })).toMatchObject({
      title: 'Assinatura DriveLocal Carro',
      quantity: 1,
      unit_price: '19.90',
      external_code: 'driver_subscription_car',
    });
  });

  test('adds registration date only when a valid profile timestamp exists', () => {
    expect(buildAdditionalInfo({ createdAt: new Date('2026-07-01T12:00:00.000Z') })).toEqual({
      payer: { registration_date: '2026-07-01T12:00:00.000Z' },
    });
    expect(buildAdditionalInfo({})).toBeNull();
  });

  test('accepts only bounded Mercado Pago device session identifiers', () => {
    expect(normalizeDeviceSessionId('device-session_123')).toBe('device-session_123');
    expect(() => normalizeDeviceSessionId('bad value with spaces')).toThrow();
    expect(normalizeDeviceSessionId(null)).toBeNull();
  });
});

describe('Mercado Pago Orders API request', () => {
  test('sends quality fields and keeps PII out of metadata', async () => {
    let captured;
    const fetchImpl = jest.fn(async (url, options) => {
      captured = { url, options };
      return {
        status: 201,
        text: async () => JSON.stringify({
          id: 'ORDTEST123',
          status: 'created',
          total_amount: '20.00',
          currency: 'BRL',
          transactions: {
            payments: [{
              status: 'pending',
              payment_method: { qr_code: '000201...', qr_code_base64: 'base64-value' },
            }],
          },
        }),
      };
    });

    const adapter = createMercadoPagoAdapter({
      accessToken: 'test-access-token',
      baseUrl: 'https://provider.example',
      fetchImpl,
    });

    await adapter.createPixOrder({
      localPaymentId: 'payment_local_123',
      amountCentavos: 2000,
      idempotencyKey: 'idem-key-123456',
      purpose: 'wallet_topup',
      description: 'DriveLocal saldo',
      payer: {
        email: 'driver@example.com',
        first_name: 'Carlos',
        last_name: 'Silva',
        identification: { type: 'CPF', number: '52998224725' },
      },
      items: [{
        title: 'Recarga Saldo DriveLocal',
        description: 'Recarga digital do saldo operacional do motorista parceiro',
        category_id: 'services',
        quantity: 1,
        unit_price: '20.00',
        external_code: 'driver_wallet_topup',
      }],
      additionalInfo: {
        payer: { registration_date: '2026-07-01T12:00:00.000Z' },
      },
      deviceSessionId: 'device-session_123',
    });

    const body = JSON.parse(captured.options.body);
    expect(captured.url).toBe('https://provider.example/v1/orders');
    expect(captured.options.headers).toMatchObject({
      Authorization: 'Bearer test-access-token',
      'Content-Type': 'application/json',
      'X-Idempotency-Key': 'idem-key-123456',
      'X-meli-session-id': 'device-session_123',
    });
    expect(body.items[0]).toMatchObject({
      quantity: 1,
      unit_price: '20.00',
      title: 'Recarga Saldo DriveLocal',
      category_id: 'services',
    });
    expect(body.payer.identification).toEqual({ type: 'CPF', number: '52998224725' });
    expect(body.transactions.payments[0].payment_method).toEqual({
      id: 'pix',
      type: 'bank_transfer',
    });
    expect(body.additional_info.payer.registration_date).toBe('2026-07-01T12:00:00.000Z');
    expect(body.metadata).toEqual({
      purpose: 'wallet_topup',
      localPaymentId: 'payment_local_123',
    });
    expect(JSON.stringify(body.metadata)).not.toContain('driver@example.com');
    expect(JSON.stringify(body.metadata)).not.toContain('52998224725');
    expect(JSON.stringify(body.metadata)).not.toContain('device-session_123');
  });

  test('omits the device header when the official value is unavailable', async () => {
    let headers;
    const fetchImpl = jest.fn(async (_url, options) => {
      headers = options.headers;
      return {
        status: 201,
        text: async () => JSON.stringify({
          id: 'ORDTEST124',
          status: 'created',
          total_amount: '9.90',
          currency: 'BRL',
          transactions: { payments: [{ status: 'pending', payment_method: {} }] },
        }),
      };
    });
    const adapter = createMercadoPagoAdapter({ accessToken: 'token', fetchImpl });
    await adapter.createPixOrder({
      localPaymentId: 'payment_local_124',
      amountCentavos: 990,
      idempotencyKey: 'idem-key-654321',
      purpose: 'driver_subscription',
      payer: { email: 'driver@example.com' },
      items: [{
        title: 'Assinatura DriveLocal Moto',
        category_id: 'services',
        quantity: 1,
        unit_price: '9.90',
        external_code: 'driver_subscription_moto',
      }],
      deviceSessionId: null,
    });
    expect(headers['X-meli-session-id']).toBeUndefined();
  });
});
