// @ts-check
// Aggregate-only view of the antifraud review queue for the admin dashboard.

function aggregateRiskCases(cases = []) {
  const result = {
    open: 0,
    underReview: 0,
    critical: 0,
    high: 0,
    drivers: 0,
    passengers: 0,
    fraudConfirmed: 0,
    closedNoEvidence: 0,
    byReason: {},
  };

  cases.forEach((entry) => {
    const status = String(entry?.status || 'open');
    const active = status === 'open' || status === 'under_review';
    if (status === 'open') result.open += 1;
    if (status === 'under_review') result.underReview += 1;
    if (active && entry?.severity === 'critical') result.critical += 1;
    if (active && entry?.severity === 'high') result.high += 1;
    if (active && entry?.actorType === 'driver') result.drivers += 1;
    if (active && entry?.actorType === 'passenger') result.passengers += 1;
    if (status === 'fraud_confirmed') result.fraudConfirmed += 1;
    if (status === 'closed_no_evidence') result.closedNoEvidence += 1;
    const reason = String(entry?.primaryReasonCode || 'UNKNOWN');
    result.byReason[reason] = Number(result.byReason[reason] || 0) + 1;
  });

  result.active = result.open + result.underReview;
  return result;
}

module.exports = { aggregateRiskCases };
