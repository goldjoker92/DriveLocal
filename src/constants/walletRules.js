// Wallet rules. The authoritative values live on serviceAreas/{id}.pricing.
// These constants are safe fallback defaults used by the UI before the
// active serviceArea is loaded. Cloud Functions must always read from
// Firestore, never from this file.

export const WALLET_FALLBACK_LOW_THRESHOLD_CENTS = 300;
export const WALLET_FALLBACK_MIN_TOPUP_CENTS = 1000;
export const WALLET_FALLBACK_COMMISSION_RATE = 0.15;

// Helper: can a driver receive a new ride?
// - Founder driver during commission-free window: balance can be 0 or negative.
// - Otherwise: balance must be strictly above lowWalletThresholdCents.
export function canDriverReceiveRides({
  balanceCents,
  lowWalletThresholdCents,
  isFounderActive,
}) {
  if (isFounderActive) return true;
  return balanceCents > lowWalletThresholdCents;
}
