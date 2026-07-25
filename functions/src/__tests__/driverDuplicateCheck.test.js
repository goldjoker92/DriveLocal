// @ts-check

const {
  normalizedKeys,
  findDuplicateConflicts,
} = require('../drivers/duplicateCheck');
const {
  duplicateConflictSourceId,
  reviewedDuplicateOverride,
} = require('../drivers/approveDriver');
const { caseId } = require('../risk/riskEngine');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
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

  it('creates a deterministic non-reversible source for the exact matching set', () => {
    const conflict = {
      field: 'cpf',
      reasonCode: riskC.REASON.DUPLICATE_CPF,
      matchingDriverIds: ['driver-b', 'driver-a'],
    };
    const source = duplicateConflictSourceId(conflict);
    expect(source).toBe(duplicateConflictSourceId({
      ...conflict,
      matchingDriverIds: ['driver-a', 'driver-b'],
    }));
    expect(source).not.toContain('driver-a');
    expect(source).not.toContain('driver-b');
    expect(source).not.toBe(duplicateConflictSourceId({
      ...conflict,
      matchingDriverIds: ['driver-a', 'driver-b', 'driver-c'],
    }));
  });

  it('allows approval only after every exact duplicate case was closed without evidence', async () => {
    const db = makeFakeFirestore();
    const driverId = 'driver_reviewed';
    const conflicts = [
      {
        field: 'cpf',
        reasonCode: riskC.REASON.DUPLICATE_CPF,
        matchingDriverIds: ['existing-cpf'],
      },
      {
        field: 'phone',
        reasonCode: riskC.REASON.DUPLICATE_PHONE,
        matchingDriverIds: ['existing-phone'],
      },
    ];

    for (const conflict of conflicts) {
      const id = caseId({
        actorType: riskC.ACTOR_TYPE.DRIVER,
        actorId: driverId,
        reasonCode: conflict.reasonCode,
        sourceType: 'driver_application',
        sourceId: duplicateConflictSourceId(conflict),
      });
      await db.collection(riskC.COLLECTIONS.FRAUD_CASES).doc(id).set({
        status: 'closed_no_evidence',
      });
    }

    await expect(reviewedDuplicateOverride(db, driverId, conflicts))
      .resolves.toBe('antifraud_cases_closed_no_evidence');
  });

  it('requires a new review when the matching account set changes', async () => {
    const db = makeFakeFirestore();
    const driverId = 'driver_changed_conflict';
    const reviewedConflict = {
      field: 'cpf',
      reasonCode: riskC.REASON.DUPLICATE_CPF,
      matchingDriverIds: ['existing-a'],
    };
    const reviewedCaseId = caseId({
      actorType: riskC.ACTOR_TYPE.DRIVER,
      actorId: driverId,
      reasonCode: reviewedConflict.reasonCode,
      sourceType: 'driver_application',
      sourceId: duplicateConflictSourceId(reviewedConflict),
    });
    await db.collection(riskC.COLLECTIONS.FRAUD_CASES).doc(reviewedCaseId).set({
      status: 'closed_no_evidence',
    });

    await expect(reviewedDuplicateOverride(db, driverId, [{
      ...reviewedConflict,
      matchingDriverIds: ['existing-a', 'new-existing-account'],
    }])).resolves.toBeNull();
  });

  it('keeps approval blocked when one exact duplicate case is still open', async () => {
    const db = makeFakeFirestore();
    const driverId = 'driver_open_case';
    const conflict = {
      field: 'cpf',
      reasonCode: riskC.REASON.DUPLICATE_CPF,
      matchingDriverIds: ['other'],
    };
    const id = caseId({
      actorType: riskC.ACTOR_TYPE.DRIVER,
      actorId: driverId,
      reasonCode: conflict.reasonCode,
      sourceType: 'driver_application',
      sourceId: duplicateConflictSourceId(conflict),
    });
    await db.collection(riskC.COLLECTIONS.FRAUD_CASES).doc(id).set({ status: 'open' });

    await expect(reviewedDuplicateOverride(db, driverId, [conflict]))
      .resolves.toBeNull();
  });
});
