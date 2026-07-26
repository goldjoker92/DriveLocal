const {
  SOURCE_TYPE,
  SEVERITY,
  STATUS,
  alertDescriptor,
  statusTransitionAllowed,
  resolutionRequired,
} = require('../policy');

describe('admin alert policy', () => {
  it('raises only actionable support categories', () => {
    expect(alertDescriptor(SOURCE_TYPE.SUPPORT_TICKET, {
      status: 'open',
      categoryCode: 'safety_concern',
      ticketId: 'ticket-1',
    })).toMatchObject({
      alertType: 'support_safety_concern',
      severity: SEVERITY.CRITICAL,
      targetRoute: '/support-tickets',
      targetId: 'ticket-1',
    });

    expect(alertDescriptor(SOURCE_TYPE.SUPPORT_TICKET, {
      status: 'open',
      categoryCode: 'technical_error',
    })).toBeNull();
    expect(alertDescriptor(SOURCE_TYPE.SUPPORT_TICKET, {
      status: 'resolved',
      categoryCode: 'safety_concern',
    })).toBeNull();
  });

  it('maps disputes, manual review and critical risk without identity fields', () => {
    const dispute = alertDescriptor(SOURCE_TYPE.RIDE_DISPUTE, {
      status: 'disputed',
      rideId: 'ride-1',
      passengerId: 'PRIVATE_PASSENGER',
      acceptedDriverId: 'PRIVATE_DRIVER',
      paymentAmountCentavos: 2500,
    });
    expect(dispute).toMatchObject({
      alertType: 'ride_payment_dispute',
      targetId: 'ride-1',
      amountCentavos: 2500,
    });
    expect(JSON.stringify(dispute)).not.toMatch(/PRIVATE_PASSENGER|PRIVATE_DRIVER/);

    expect(alertDescriptor(SOURCE_TYPE.PAYMENT_REVIEW, {
      status: 'manual_review',
      paymentRequestId: 'pay-1',
      amountCentavos: 3000,
      manualReviewReason: 'PRIVATE_PROVIDER_TEXT',
    })).toMatchObject({
      alertType: 'payment_manual_review',
      targetId: 'pay-1',
      reasonCode: 'MANUAL_REVIEW',
    });

    expect(alertDescriptor(SOURCE_TYPE.RISK_CASE, {
      status: 'open',
      severity: 'critical',
      caseId: 'case-1',
      actorId: 'PRIVATE_ACTOR',
    })).toMatchObject({ alertType: 'risk_case_critical', severity: SEVERITY.CRITICAL });
  });

  it('alerts only failed account deletion processing', () => {
    expect(alertDescriptor(SOURCE_TYPE.ACCOUNT_DELETION, {
      status: 'failed',
      failureCode: 'storage/unavailable',
      subjectUid: 'PRIVATE_UID',
    })).toMatchObject({
      alertType: 'account_deletion_failed',
      targetId: null,
      reasonCode: 'storage/unavailable',
    });
    expect(alertDescriptor(SOURCE_TYPE.ACCOUNT_DELETION, { status: 'blocked' })).toBeNull();
    expect(alertDescriptor(SOURCE_TYPE.ACCOUNT_DELETION, { status: 'processing' })).toBeNull();
  });

  it('alerts on fatal crashes or three repeated errors without copying crash text', () => {
    const fatal = alertDescriptor(SOURCE_TYPE.CLIENT_ERROR, {
      status: 'open',
      reportId: 'cer_hash_fingerprint_bucket',
      severity: 'fatal',
      isFatal: true,
      occurrenceCount: 1,
      message: 'PRIVATE_MESSAGE',
      stack: 'PRIVATE_STACK',
      actorUid: 'PRIVATE_UID',
    });
    expect(fatal).toMatchObject({
      alertType: 'client_error_fatal',
      severity: SEVERITY.CRITICAL,
      reasonCode: 'FATAL_CLIENT_ERROR',
      targetId: 'cer_hash_fingerprint_bucket',
    });
    expect(JSON.stringify(fatal)).not.toMatch(/PRIVATE_MESSAGE|PRIVATE_STACK|PRIVATE_UID/);

    expect(alertDescriptor(SOURCE_TYPE.CLIENT_ERROR, {
      status: 'open',
      severity: 'error',
      occurrenceCount: 2,
    })).toBeNull();
    expect(alertDescriptor(SOURCE_TYPE.CLIENT_ERROR, {
      status: 'open',
      reportId: 'cer_repeated',
      severity: 'error',
      occurrenceCount: 3,
    })).toMatchObject({
      alertType: 'client_error_repeated',
      severity: SEVERITY.HIGH,
      reasonCode: 'REPEATED_CLIENT_ERROR',
    });
    expect(alertDescriptor(SOURCE_TYPE.CLIENT_ERROR, {
      status: 'resolved',
      severity: 'fatal',
      isFatal: true,
    })).toBeNull();
  });

  it('keeps explicit admin transitions and terminal resolution codes', () => {
    expect(statusTransitionAllowed(STATUS.OPEN, STATUS.ACKNOWLEDGED)).toBe(true);
    expect(statusTransitionAllowed(STATUS.ACKNOWLEDGED, STATUS.IN_PROGRESS)).toBe(true);
    expect(statusTransitionAllowed(STATUS.IN_PROGRESS, STATUS.RESOLVED)).toBe(true);
    expect(statusTransitionAllowed(STATUS.RESOLVED, STATUS.ACKNOWLEDGED)).toBe(false);
    expect(statusTransitionAllowed(STATUS.RESOLVED, STATUS.OPEN)).toBe(true);
    expect(resolutionRequired(STATUS.RESOLVED)).toBe(true);
    expect(resolutionRequired(STATUS.IN_PROGRESS)).toBe(false);
  });
});
