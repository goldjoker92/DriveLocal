const {
  PIX_KEY_TYPE,
  validateAndNormalizePixKey,
} = require('./pixKey');
const { buildPixPayload, crc16 } = require('./pixBrCode');

describe('authoritative Pix key and BR Code validation', () => {
  test('normalizes formatted CPF before embedding it', () => {
    const payload = buildPixPayload({
      pixKey: '529.982.247-25',
      pixKeyType: 'CPF',
      amountCentavos: 1400,
      merchantName: 'Motorista Teste',
      city: 'Horizonte',
      txid: 'ride123',
    });
    expect(payload).toContain('011152998224725');
    expect(payload).not.toContain('.');
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  test('rejects invalid CPF and amount', () => {
    expect(() => buildPixPayload({
      pixKey: '024.995.773-635',
      pixKeyType: 'CPF',
      amountCentavos: 1400,
      merchantName: 'Motorista',
      city: 'Horizonte',
      txid: 'ride',
    })).toThrow('Invalid Pix key');

    expect(() => buildPixPayload({
      pixKey: 'motorista@example.com',
      pixKeyType: 'E-mail',
      amountCentavos: 0,
      merchantName: 'Motorista',
      city: 'Horizonte',
      txid: 'ride',
    })).toThrow('Invalid Pix amount');
  });

  test('normalizes every supported key type', () => {
    expect(validateAndNormalizePixKey('(85) 99999-9999', 'Telefone')).toMatchObject({
      valid: true,
      value: '+5585999999999',
      type: PIX_KEY_TYPE.PHONE,
    });
    expect(validateAndNormalizePixKey('MOTORISTA@EXAMPLE.COM', 'E-mail').value)
      .toBe('motorista@example.com');
    expect(validateAndNormalizePixKey(
      '123E4567-E89B-12D3-A456-426614174000',
      'Chave aleatória'
    ).value).toBe('123e4567-e89b-12d3-a456-426614174000');
  });
});
