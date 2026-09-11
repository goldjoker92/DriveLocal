import { normalizePixKey } from '../pixKey';

describe('mobile Pix key validation', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test.each([
    ['CPF', '529.982.247-25', '52998224725'],
    ['Telefone', '(85) 99999-1234', '+5585999991234'],
    ['E-mail', ' Motorista@Example.COM ', 'motorista@example.com'],
    ['Chave aleatória', '123E4567-E12B-12D1-A456-426655440000',
      '123e4567-e12b-12d1-a456-426655440000'],
  ])('normalizes %s before saving', (type, input, expected) => {
    expect(normalizePixKey(input, type)).toMatchObject({ valid: true, key: expected });
  });

  test.each([
    ['CPF', '000.000.000-00'],
    ['Telefone', '1234'],
    ['E-mail', 'invalido'],
    ['Chave aleatória', 'invalida'],
  ])('rejects an invalid %s key', (type, input) => {
    expect(normalizePixKey(input, type).valid).toBe(false);
  });
});
