// Driver verification statuses — single source of truth for labels + badge tones.
// Reused by the admin dashboard, the drivers list and the driver detail screen
// so PT-BR wording and colors stay consistent across the console.
//
// Business rule (Iteration 1): a driver only becomes eligible for rides once an
// admin sets verificationStatus to "approved". None of these transitions charge
// money — commission is only applied later, on completed rides.

// Canonical verification statuses (persistent on drivers/{uid}).
export const VERIFICATION_STATUS = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  CORRECTION_REQUESTED: 'correction_requested',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
};

// PT-BR label shown to the admin for each verificationStatus.
export const VERIFICATION_STATUS_LABELS = {
  draft: 'Rascunho',
  pending_review: 'Em análise',
  approved: 'Aprovado',
  correction_requested: 'Correção solicitada',
  rejected: 'Recusado',
  suspended: 'Suspenso',
};

// AppBadge tone per status: 'success' | 'warning' | 'danger' | 'neutral'.
export const VERIFICATION_STATUS_TONES = {
  draft: 'neutral',
  pending_review: 'warning',
  approved: 'success',
  correction_requested: 'warning',
  rejected: 'danger',
  suspended: 'danger',
};

// PT-BR label for documentsStatus (missing | submitted | approved | rejected).
export const DOCUMENTS_STATUS_LABELS = {
  missing: 'Documentos faltando',
  submitted: 'Documentos enviados',
  approved: 'Documentos aprovados',
  rejected: 'Documentos recusados',
};

// Helpers with safe fallbacks so an unknown/undefined value never crashes the UI.
export function verificationLabel(status) {
  return VERIFICATION_STATUS_LABELS[status] || status || '—';
}

export function verificationTone(status) {
  return VERIFICATION_STATUS_TONES[status] || 'neutral';
}

export function documentsLabel(status) {
  return DOCUMENTS_STATUS_LABELS[status] || status || '—';
}
