const {
  PASSENGER_PUBLIC_FALLBACK_NAME,
  safeAcceptedPassengerFirstName,
} = require('../passengerPublicIdentity');

describe('mobile accepted passenger public identity', () => {
  it('renders only the first valid name token', () => {
    expect(safeAcceptedPassengerFirstName({ firstName: 'Maria Clara' })).toBe('Maria');
    expect(safeAcceptedPassengerFirstName({ firstName: 'João-Pedro Silva' })).toBe('João-Pedro');
    expect(safeAcceptedPassengerFirstName({ firstName: "D’Ávila Santos" })).toBe('D’Ávila');
  });

  it.each([
    null,
    {},
    { firstName: '' },
    { firstName: 'maria@example.com' },
    { firstName: '+55 85 99999-9999' },
  ])('uses the generic fallback for unsafe value %#', (identity) => {
    expect(safeAcceptedPassengerFirstName(identity)).toBe(PASSENGER_PUBLIC_FALLBACK_NAME);
  });

  it('limits the rendered token to forty characters', () => {
    const result = safeAcceptedPassengerFirstName({ firstName: 'A'.repeat(80) });
    expect(result).toHaveLength(40);
  });
});
