const { classifyLegacyPaidPlans } = require('../legacy-paid-plan-audit');

const row = (id, values) => ({ id, data: () => values });

test('requires human review for paid, pending, orphaned and manual historical plans', () => {
  const report = classifyLegacyPaidPlans({
    requests: [
      row('paid-1', { purpose: 'driver_subscription', status: 'paid' }),
      row('pending-1', { purpose: 'driver_subscription', status: 'pending' }),
      row('old-failed', { purpose: 'driver_subscription', status: 'failed' }),
      row('wallet', { purpose: 'wallet_topup', status: 'paid' }),
    ],
    previousPayments: [
      row('orphan-record', { paymentId: 'missing-request' }),
      row('unknown-record', {}),
    ],
    drivers: [
      row('manual-driver', { subscriptionPaymentMode: 'manual_pix' }),
      row('admin-driver', { subscriptionPaymentMode: 'manual_admin' }),
      row('provider-driver', { subscriptionPaymentMode: 'pix_webhook' }),
      row('unknown-driver', { subscriptionStatus: 'active' }),
    ],
  });

  expect(report).toMatchObject({
    needsReview: true,
    unresolvedPaymentIds: ['paid-1'],
    providerCheckPaymentIds: ['pending-1'],
    orphanedPaymentIds: ['missing-request'],
    recordsWithoutPaymentId: ['unknown-record'],
    manualPixDriverIds: ['manual-driver'],
    manualActivationReviewDriverIds: ['admin-driver'],
    otherPaidPlanDriverIds: ['provider-driver', 'unknown-driver'],
  });
});

test('clears the release gate only after each historical lead is resolved', () => {
  const reviewed = classifyLegacyPaidPlans({
    requests: [
      row('refunded', { purpose: 'driver_subscription', status: 'refunded' }),
      row('resolved', { purpose: 'driver_subscription', status: 'paid', legacyResolutionReviewedAtMs: 123 }),
    ],
    previousPayments: [row('reviewed-orphan', { legacyResolutionReviewedAtMs: 123 })],
    drivers: [row('manual-reviewed', {
      subscriptionPaymentMode: 'manual_pix', legacyResolutionReviewedAtMs: 123,
    })],
  });

  expect(reviewed.needsReview).toBe(false);
  expect(reviewed.manualPixDriverIds).toEqual([]);
  expect(reviewed.unresolvedPaymentIds).toEqual([]);
});
