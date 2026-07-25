// @ts-check

const { safeCase } = require('../risk/adminCases');
const { aggregateRiskCases } = require('../risk/caseAnalytics');

describe('admin risk case projections', () => {
  it('returns only review metadata and excludes unknown sensitive fields', () => {
    const projected = safeCase({
      id: 'case_1',
      data: () => ({
        actorType: 'driver',
        actorId: 'd1',
        primaryReasonCode: 'DUPLICATE_CPF',
        severity: 'high',
        recommendedAction: 'require_review',
        sourceType: 'driver_application',
        sourceId: 'd1',
        linkedEventIds: ['e1', 'e2'],
        status: 'open',
        openedAtMs: 100,
        updatedAtMs: 200,
        cpf: '12345678909',
        pixKey: 'secret@example.com',
        privateDocumentPath: 'private/path.jpg',
      }),
    });

    expect(projected).toMatchObject({
      caseId: 'case_1',
      actorType: 'driver',
      primaryReasonCode: 'DUPLICATE_CPF',
      linkedEventCount: 2,
      status: 'open',
    });
    expect(projected).not.toHaveProperty('cpf');
    expect(projected).not.toHaveProperty('pixKey');
    expect(projected).not.toHaveProperty('privateDocumentPath');
  });

  it('separates active cases, confirmed fraud and false positives', () => {
    const result = aggregateRiskCases([
      { status: 'open', severity: 'critical', actorType: 'driver', primaryReasonCode: 'WALLET_LEDGER_MISMATCH' },
      { status: 'under_review', severity: 'high', actorType: 'passenger', primaryReasonCode: 'REPEATED_CANCELLATIONS' },
      { status: 'fraud_confirmed', severity: 'high', actorType: 'passenger', primaryReasonCode: 'PASSENGER_FALSE_PAYMENT_PATTERN' },
      { status: 'closed_no_evidence', severity: 'medium', actorType: 'driver', primaryReasonCode: 'IMPOSSIBLE_GPS_SPEED' },
    ]);

    expect(result).toMatchObject({
      open: 1,
      underReview: 1,
      active: 2,
      critical: 1,
      high: 1,
      drivers: 1,
      passengers: 1,
      fraudConfirmed: 1,
      closedNoEvidence: 1,
    });
  });
});
