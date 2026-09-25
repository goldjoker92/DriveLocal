// Founder offer rules.
//
// First 100 approved drivers (moto + car combined, across service areas) become
// "Motorista Fundador":
//   - permanent Motorista Fundador badge.
// Every approved driver receives 0% commission for 60 days from approval.
//
// "Approved" means admin approved, NOT registered.
// Counter must be incremented inside a Firestore transaction in the
// approveDriver Cloud Function.

export const FOUNDER_DEFAULT_MAX_DRIVERS = 100;

// UI label per spec — never change without product confirmation.
export const FOUNDER_LABEL_PT_BR = 'Motorista Fundador';
export const FOUNDER_OFFER_HEADLINE_PT_BR = 'Primeiros 100 motoristas aprovados';
