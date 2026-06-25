// Founder offer rules.
//
// First 100 approved drivers (moto + car combined) per serviceArea become
// "Motorista Fundador":
//   - 0% commission for 60 days
//   - R$0 monthly subscription for 60 days
//   - 100% of ride value to driver Pix
//   - Motorista Fundador badge
//
// "Approved" means admin approved, NOT registered.
// Counter must be incremented inside a Firestore transaction in the
// approveDriver Cloud Function.

export const FOUNDER_DEFAULT_MAX_DRIVERS = 100;
export const FOUNDER_DEFAULT_COMMISSION_FREE_DAYS = 60;
export const FOUNDER_DEFAULT_SUBSCRIPTION_FREE_DAYS = 60;

// UI label per spec — never change without product confirmation.
export const FOUNDER_LABEL_PT_BR = 'Motorista Fundador';
export const FOUNDER_OFFER_HEADLINE_PT_BR = 'Primeiros 100 motoristas aprovados';

// Helper: is a founder driver still inside their commission-free window?
export function isFounderCommissionFreeActive(driver, nowMs) {
  if (!driver || !driver.isFounder) return false;
  if (!driver.commissionFreeUntil) return false;
  return nowMs < driver.commissionFreeUntil;
}
