'use strict';

// Pure classification for the read-only release audit. An unresolved historical
// payment or a possible manual Pix receipt requires a human resolution.
function classifyLegacyPaidPlans({ requests, previousPayments, drivers }) {
  const oldRequests = requests.filter((doc) => doc.data()?.purpose === 'driver_subscription');
  const unreviewedPreviousPayments = previousPayments
    .filter((doc) => !doc.data()?.legacyResolutionReviewedAtMs);
  const previousIds = new Set(unreviewedPreviousPayments.map((doc) => doc.data()?.paymentId).filter(Boolean));
  const recordsWithoutPaymentId = unreviewedPreviousPayments
    .filter((doc) => !doc.data()?.paymentId).map((doc) => doc.id);
  const unresolved = new Set();
  const providerCheck = new Set();
  for (const doc of oldRequests) {
    const data = doc.data() || {};
    if (data.status === 'refunded' || data.legacyResolutionReviewedAtMs) continue;
    if (['paid', 'manual_review'].includes(data.status) || previousIds.has(doc.id)) {
      unresolved.add(doc.id);
    } else if (!['cancelled', 'expired', 'failed'].includes(data.status)) {
      providerCheck.add(doc.id);
    }
  }
  const orphaned = [...previousIds].filter((id) => !oldRequests.some((doc) => doc.id === id));
  const manualPixDriverIds = [];
  const manualActivationReviewDriverIds = [];
  const otherPaidPlanDriverIds = [];
  for (const doc of drivers) {
    const data = doc.data() || {};
    if (data.legacyResolutionReviewedAtMs) continue;
    if (data.subscriptionPaymentMode === 'manual_pix') manualPixDriverIds.push(doc.id);
    if (['manual_admin', 'manual_admin_test'].includes(data.subscriptionPaymentMode)) {
      manualActivationReviewDriverIds.push(doc.id);
    }
    if (data.subscriptionPaymentMode === 'pix_webhook'
      || (data.subscriptionStatus === 'active' && !data.subscriptionPaymentMode)) {
      otherPaidPlanDriverIds.push(doc.id);
    }
  }
  const report = {
    historicalRequests: oldRequests.length, historicalDriverProfiles: drivers.length,
    paidRecords: previousPayments.length,
    unresolvedPaymentIds: [...unresolved].sort(),
    providerCheckPaymentIds: [...providerCheck].sort(),
    orphanedPaymentIds: orphaned.sort(),
    recordsWithoutPaymentId: recordsWithoutPaymentId.sort(),
    manualPixDriverIds: manualPixDriverIds.sort(),
    manualActivationReviewDriverIds: manualActivationReviewDriverIds.sort(),
    otherPaidPlanDriverIds: otherPaidPlanDriverIds.sort(),
  };
  return { ...report, needsReview: Object.values(report).some((value) => Array.isArray(value) && value.length > 0) };
}

module.exports = { classifyLegacyPaidPlans };
