// @ts-check

const {
  normalizedKeys,
  findDuplicateConflicts,
} = require('../drivers/duplicateCheck');
const riskC = require('../risk/constants');

describe('driver launch duplicate checks', () => {
  it('normalizes CPF, plate, Pix, phone and email without exposing formatting differences', () => {
    expect(normalizedKeys({
      cpf: '123.456.789-09',
      vehiclePlate: 'abc-1d23',
      pixKey: ' Test@Email.COM ',
      whatsApp: '+55 (85) 99999-1111',
      email: ' USER@EXAMPLE.COM ',
    })).toEqual({
      cpf: '12345678909',
      plate: 'ABC1D23',
      pix: 'test@email.com',
      phone: '5585999991111',
      email: 'user@example.com',
    });
  });

  it('detects active duplicate identities but ignores the target and rejected/draft accounts', () => {
    const target = {
      cpf: '123.456.789-09',
      vehiclePlate: 'ABC1D23',
      pixKey: 'driver@pix.com',
      whatsApp: '85999991111',
      email: 'driver@example.com',
    };
    const conflicts = findDuplicateConflicts('target', target, [
      { driverId: 'target', data: { ...target, verificationStatus: 'pending_review' } },
      { driverId: 'approved_other', data: { ...target, verificationStatus: 'approved' } },
      { driverId: 'rejected_other', data: { ...target, verificationStatus: 'rejected' } },
      { driverId: 'draft_other', data: { ...target, verificationStatus: 'draft' } },
    ]);

    expect(conflicts.map((conflict) => conflict.reasonCode).sort()).toEqual([
      riskC.REASON.DUPLICATE_CPF,
      riskC.REASON.DUPLICATE_EMAIL,
      riskC.REASON.DUPLICATE_PHONE,
      riskC.REASON.DUPLICATE_PIX_KEY,
      riskC.REASON.DUPLICATE_VEHICLE_PLATE,
    ].sort());
    expect(conflicts.every((conflict) => conflict.matchingDriverIds.includes('approved_other'))).toBe(true);
    expect(conflicts.some((conflict) => conflict.matchingDriverIds.includes('rejected_other'))).toBe(false);
  });

  it('treats CPF as a hard identity conflict and a shared plate as reviewable', () => {
    const conflicts = findDuplicateConflicts('target', {
      cpf: '12345678909',
      vehiclePlate: 'ABC1D23',
    }, [{
      driverId: 'other',
      data: { cpf: '12345678909', vehiclePlate: 'ABC-1D23', verificationStatus: 'approved' },
    }]);

    expect(conflicts.find((conflict) => conflict.reasonCode === riskC.REASON.DUPLICATE_CPF)?.hard).toBe(true);
    expect(conflicts.find((conflict) => conflict.reasonCode === riskC.REASON.DUPLICATE_VEHICLE_PLATE)?.hard).toBe(false);
  });
});
