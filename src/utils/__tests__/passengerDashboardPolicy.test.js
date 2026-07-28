const { getPassengerFirstName } = require('../passengerDashboardPolicy');

describe('passenger dashboard policy', () => {
  it('uses the first safe profile name for the greeting', () => {
    expect(getPassengerFirstName({ fullName: '  Guillaume   Ragot ' }, null)).toBe('Guillaume');
    expect(getPassengerFirstName({}, { displayName: 'Maria Silva' })).toBe('Maria');
    expect(getPassengerFirstName({ name: 'João da Silva' }, null)).toBe('João');
  });

  it('does not expose an email as a passenger name', () => {
    expect(getPassengerFirstName({ fullName: 'user@example.com' }, {})).toBe('Passageiro');
    expect(getPassengerFirstName({}, {})).toBe('Passageiro');
  });

  it('normalizes spacing and bounds the displayed value', () => {
    expect(getPassengerFirstName({ fullName: '  Ana\u00a0\u00a0Clara  ' }, null)).toBe('Ana');
    expect(getPassengerFirstName({ fullName: `${'A'.repeat(80)} Silva` }, null)).toHaveLength(40);
  });
});
