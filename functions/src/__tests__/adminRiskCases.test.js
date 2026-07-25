// @ts-check

const {
  listAdminRiskCases,
  decideAdminRiskCase,
} = require('../risk/adminCases');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const riskC = require('../risk/constants');

const NOW = Date.parse('2026-08-10T12:00:00.000Z');
const ADMIN = 'admin_cases_test';

function adminRequest(data) {
  return { auth: { uid: ADMIN }, data };
}

describe('admin antifraud case workflow', () => {
  it('filters by status before applying the bounded result limit', async () => {
    const db = makeFakeFirestore();
    await db.collection('admins').doc(ADMIN).set({ active: true });
    await db.collection(riskC.COLLECTIONS.FRAUD_CASES).doc('resolved-case').set({
      status: 'resolved',
      updatedAtMs: NOW + 1,
    });
    await db.collection(riskC.COLLECTIONS.FRAUD_CASES).doc('open-case').set({
      status: 'open',
      updatedAtMs: NOW,
    });

    const result = await listAdminRiskCases({
      db,
      request: adminRequest({ status: 'open', limit: 10 }),
      context: { traceId: 'trace_list_cases' },
    });
    expect(result.cases.map((entry) => entry.caseId)).toEqual(['open-case']);
  });

  it('closing an unrelated case never clears another active restriction', async () => {
    const db = makeFakeFirestore();
    await db.collection('admins').doc(ADMIN).set({ active: true });
    await db.collection('passengers').doc('p1').set({
      riskBlockedFromNewRides: true,
      riskRestrictions: [{ caseId: 'restriction-case', untilMs: NOW + 86400000 }],
      riskRestrictionCaseId: 'restriction-case',
      riskRestrictionUntilMs: NOW + 86400000,
    });
    await db.collection(riskC.COLLECTIONS.FRAUD_CASES).doc('duplicate-case').set({
      caseId: 'duplicate-case',
      actorType: 'passenger',
      actorId: 'p1',
      status: 'open',
      primaryReasonCode: 'DUPLICATE_PHONE',
      severity: 'medium',
      sourceType: 'passenger_application',
      sourceId: 'p1',
    });

    await decideAdminRiskCase({
      db,
      request: adminRequest({
        caseId: 'duplicate-case',
        outcome: 'close_no_evidence',
        reasonCode: 'ADMIN_NO_EVIDENCE',
        idempotencyKey: 'risk-close-unrelated-01',
      }),
      context: { traceId: 'trace_close_unrelated' },
      clock: fixedClock(NOW),
    });

    const passenger = db._store.get('passengers/p1');
    expect(passenger.riskBlockedFromNewRides).toBe(true);
    expect(passenger.riskRestrictionCaseId).toBe('restriction-case');
    expect(passenger.riskRestrictions).toEqual([
      { caseId: 'restriction-case', untilMs: NOW + 86400000 },
    ]);
  });
});
