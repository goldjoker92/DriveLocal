// @ts-check
// Temporary rollout bridge for APKs built before predefined cancellation reasons.
// Only the two exact historical constants are accepted; arbitrary text stays strict.

const LEGACY_CANCELLATION_REASON_MAP = Object.freeze({
  motorista_cancelou: 'driver_other',
  passageiro_cancelou: 'passenger_other',
});

function normalizeLegacyCancellationReason(reasonCode) {
  const code = String(reasonCode || '');
  return LEGACY_CANCELLATION_REASON_MAP[code] || code;
}

function normalizedCancellationRequest(request) {
  const original = request?.data?.reasonCode;
  const normalized = normalizeLegacyCancellationReason(original);
  if (normalized === original) return request;
  return {
    ...request,
    data: {
      ...(request?.data || {}),
      reasonCode: normalized,
    },
  };
}

module.exports = {
  LEGACY_CANCELLATION_REASON_MAP,
  normalizeLegacyCancellationReason,
  normalizedCancellationRequest,
};