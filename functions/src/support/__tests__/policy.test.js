const {
  STATUS,
  CATEGORIES,
  RESOLUTION_CODES,
  categoryDefinition,
  categoryAllowedForRole,
  statusTransitionAllowed,
  resolutionRequired,
} = require('../policy');

describe('support ticket policy', () => {
  it('keeps a closed category vocabulary with explicit roles', () => {
    expect(Object.keys(CATEGORIES)).toEqual([
      'ride_status_issue',
      'cancellation_issue',
      'safety_concern',
      'fare_payment_issue',
      'driver_or_vehicle_mismatch',
      'passenger_no_show_review',
      'wallet_topup_issue',
      'subscription_issue',
      'document_review_issue',
      'account_access_issue',
      'technical_error',
    ]);
    expect(categoryAllowedForRole('driver_or_vehicle_mismatch', 'passenger')).toBe(true);
    expect(categoryAllowedForRole('driver_or_vehicle_mismatch', 'driver')).toBe(false);
    expect(categoryAllowedForRole('wallet_topup_issue', 'driver')).toBe(true);
    expect(categoryAllowedForRole('wallet_topup_issue', 'passenger')).toBe(false);
    expect(categoryAllowedForRole('unknown', 'driver')).toBe(false);
  });

  it('marks ride and payment context requirements explicitly', () => {
    expect(categoryDefinition('ride_status_issue')).toMatchObject({ requiresRide: true });
    expect(categoryDefinition('fare_payment_issue')).toMatchObject({ requiresRide: true });
    expect(categoryDefinition('wallet_topup_issue')).toMatchObject({ paymentPurpose: 'wallet_topup' });
    expect(categoryDefinition('subscription_issue')).toMatchObject({ paymentPurpose: 'driver_subscription' });
    expect(categoryDefinition('technical_error')).toEqual({ roles: ['driver', 'passenger'] });
  });

  it('allows only explicit admin status transitions', () => {
    expect(statusTransitionAllowed(STATUS.OPEN, STATUS.IN_REVIEW)).toBe(true);
    expect(statusTransitionAllowed(STATUS.OPEN, STATUS.RESOLVED)).toBe(true);
    expect(statusTransitionAllowed(STATUS.RESOLVED, STATUS.OPEN)).toBe(true);
    expect(statusTransitionAllowed(STATUS.CLOSED, STATUS.IN_REVIEW)).toBe(false);
    expect(statusTransitionAllowed('unknown', STATUS.OPEN)).toBe(false);
  });

  it('requires a closed resolution code only for terminal statuses', () => {
    expect(RESOLUTION_CODES).toContain('payment_under_review');
    expect(RESOLUTION_CODES).toContain('safety_escalated');
    expect(resolutionRequired(STATUS.RESOLVED)).toBe(true);
    expect(resolutionRequired(STATUS.CLOSED)).toBe(true);
    expect(resolutionRequired(STATUS.OPEN)).toBe(false);
    expect(resolutionRequired(STATUS.IN_REVIEW)).toBe(false);
  });
});