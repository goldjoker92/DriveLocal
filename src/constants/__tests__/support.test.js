const {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUS,
  SUPPORT_RESOLUTIONS,
  supportCategoryOptions,
  supportCategoryLabel,
  supportStatusLabel,
  supportResolutionLabel,
  shortSupportReference,
} = require('../support');

describe('support client catalog', () => {
  it('matches the closed server category vocabulary', () => {
    expect(SUPPORT_CATEGORIES.map((category) => category.code)).toEqual([
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
  });

  it('filters by role and ride context', () => {
    expect(supportCategoryOptions('passenger', false).map((item) => item.code)).toEqual([
      'account_access_issue',
      'technical_error',
    ]);
    expect(supportCategoryOptions('driver', false).map((item) => item.code)).toEqual([
      'wallet_topup_issue',
      'subscription_issue',
      'document_review_issue',
      'account_access_issue',
      'technical_error',
    ]);
    expect(supportCategoryOptions('passenger', true).map((item) => item.code)).toContain(
      'driver_or_vehicle_mismatch',
    );
    expect(supportCategoryOptions('driver', true).map((item) => item.code)).toContain(
      'passenger_no_show_review',
    );
  });

  it('provides stable labels and short references', () => {
    expect(supportCategoryLabel('fare_payment_issue')).toBe('Problema com o pagamento da corrida');
    expect(supportStatusLabel('in_review')).toBe('Em análise');
    expect(supportResolutionLabel('safety_escalated')).toBe('Caso de segurança encaminhado');
    expect(shortSupportReference('short-id')).toBe('short-id');
    expect(shortSupportReference('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefg…vwxyz');
  });

  it('keeps status and resolution vocabularies closed', () => {
    expect(Object.keys(SUPPORT_STATUS)).toEqual(['open', 'in_review', 'resolved', 'closed']);
    expect(Object.keys(SUPPORT_RESOLUTIONS)).toEqual([
      'guidance_provided',
      'payment_under_review',
      'operation_corrected',
      'no_adjustment_required',
      'safety_escalated',
      'duplicate_ticket',
      'resolved_by_system',
    ]);
  });
});