const { normalizePixKey } = require('../pix/pixKey');
const { syncDriverPixKeyForRide } = require('../pix/driverPixSync');
const { evaluateRideEligibility } = require('../drivers/eligibility');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');

const NOW = Date.parse('2026-09-11T12:00:00.000Z');

describe('Pix key normalization', () => {
  test.each([
    ['CPF', '529.982.247-25', '52998224725'],
    ['Telefone', '(85) 99999-1234', '+5585999991234'],
    ['Telefone', '+55 85 99999-1234', '+5585999991234'],
    ['E-mail', ' Motorista@Example.COM ', 'motorista@example.com'],
    ['Chave aleatória', '123E4567-E12B-12D1-A456-426655440000',
      '123e4567-e12b-12d1-a456-426655440000'],
  ])('%s is normalized to the DICT BR Code format', (type, input, expected) => {
    expect(normalizePixKey(input, type)).toMatchObject({ valid: true, key: expected });
  });

  test.each([
    ['CPF', '000.000.000-00'],
    ['Telefone', '9999'],
    ['E-mail', 'sem-arroba'],
    ['Chave aleatória', 'not-a-uuid'],
  ])('%s rejects malformed keys', (type, input) => {
    const result = normalizePixKey(input, type);
    expect(result.valid).toBe(false);
    expect(result.key).toBeNull();
  });
});

describe('driver Pix synchronization', () => {
  it('normalizes the public phone and replaces a stale private key', async () => {
    const db = makeFakeFirestore();
    await db.collection('drivers').doc('D1').set({
      fullName: 'Motorista Teste',
      pixKeyType: 'Telefone',
      pixKey: '(85) 99999-1234',
    });
    await db.collection('privateDriverData').doc('D1').set({
      pixKeyType: 'E-mail',
      pixKey: 'old@example.com',
    });

    const result = await syncDriverPixKeyForRide({ db, driverId: 'D1' });

    expect(result).toMatchObject({ synced: true, privateKeyValid: true });
    expect(db._store.get('drivers/D1')).toMatchObject({
      pixKeyType: 'Telefone',
      pixKey: '+5585999991234',
    });
    expect(db._store.get('privateDriverData/D1')).toMatchObject({
      pixKeyType: 'Telefone',
      pixKey: '+5585999991234',
      pixOwnerName: 'Motorista Teste',
    });
  });

  it('preserves a valid private key when the legacy public key is malformed', async () => {
    const db = makeFakeFirestore();
    await db.collection('drivers').doc('D2').set({
      pixKeyType: 'Chave aleatória',
      pixKey: 'invalid',
    });
    await db.collection('privateDriverData').doc('D2').set({
      pixKeyType: 'E-mail',
      pixKey: 'valid@example.com',
    });

    const result = await syncDriverPixKeyForRide({ db, driverId: 'D2' });

    expect(result).toMatchObject({ synced: false, privateKeyValid: true });
    expect(db._store.get('privateDriverData/D2').pixKey).toBe('valid@example.com');
  });
});

describe('ride eligibility Pix gate', () => {
  const baseDriver = {
    verificationStatus: 'approved',
    isBlocked: false,
    subscriptionActive: true,
    subscriptionExpiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
  };
  const clock = { now: () => NOW };

  it('keeps a valid formatted key eligible and rejects a malformed key', () => {
    const valid = evaluateRideEligibility({
      ...baseDriver,
      pixKeyType: 'Telefone',
      pixKey: '(85) 99999-1234',
    }, clock);
    const invalid = evaluateRideEligibility({
      ...baseDriver,
      pixKeyType: 'Chave aleatória',
      pixKey: 'invalid',
    }, clock);

    expect(valid.pixKeyValid).toBe(true);
    expect(valid.canReceiveRides).toBe(true);
    expect(invalid.pixKeyValid).toBe(false);
    expect(invalid.canReceiveRides).toBe(false);
    expect(invalid.pixKeyReasonCode).toBe('PIX_KEY_RANDOM_INVALID');
  });
});
