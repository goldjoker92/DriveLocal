import {
  PIX_KEY_TYPE,
  canonicalPixKeyType,
  validateAndNormalizePixKey,
} from '../pixKey';

describe('Pix key validation', () => {
  test('normalizes and validates a formatted CPF', () => {
    expect(validateAndNormalizePixKey('529.982.247-25', 'CPF')).toEqual({
      valid: true,
      value: '52998224725',
      type: PIX_KEY_TYPE.CPF,
      message: '',
    });
  });

  test('rejects invalid CPF values', () => {
    expect(validateAndNormalizePixKey('024.995.773-635', 'CPF').valid).toBe(false);
    expect(validateAndNormalizePixKey('111.111.111-11', 'CPF').valid).toBe(false);
  });

  test('normalizes phone, email and random keys', () => {
    expect(validateAndNormalizePixKey('(85) 99999-9999', 'Telefone').value)
      .toBe('+5585999999999');
    expect(validateAndNormalizePixKey('MOTORISTA@EXEMPLO.COM', 'E-mail').value)
      .toBe('motorista@exemplo.com');
    expect(validateAndNormalizePixKey(
      '123E4567-E89B-12D3-A456-426614174000',
      'Chave aleatória'
    ).value).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  test('recognizes the four UI labels', () => {
    expect(canonicalPixKeyType('CPF')).toBe(PIX_KEY_TYPE.CPF);
    expect(canonicalPixKeyType('Telefone')).toBe(PIX_KEY_TYPE.PHONE);
    expect(canonicalPixKeyType('E-mail')).toBe(PIX_KEY_TYPE.EMAIL);
    expect(canonicalPixKeyType('Chave aleatória')).toBe(PIX_KEY_TYPE.EVP);
  });
});
