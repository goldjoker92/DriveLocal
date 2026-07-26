export const ADMIN_ALERT_STATUS = Object.freeze({
  open: { label: 'Aberto', tone: 'danger' },
  acknowledged: { label: 'Reconhecido', tone: 'warning' },
  in_progress: { label: 'Em tratamento', tone: 'warning' },
  resolved: { label: 'Resolvido', tone: 'success' },
});

export const ADMIN_ALERT_SEVERITY = Object.freeze({
  warning: { label: 'Atenção', tone: 'warning' },
  high: { label: 'Alta', tone: 'danger' },
  critical: { label: 'Crítica', tone: 'danger' },
});

export const ADMIN_ALERT_TITLES = Object.freeze({
  support_safety_concern: 'Sinalização de segurança no suporte',
  support_financial_issue: 'Problema financeiro no suporte',
  ride_payment_dispute: 'Pagamento de corrida em disputa',
  payment_manual_review: 'Pagamento Mercado Pago em revisão',
  risk_case_high: 'Caso antifraude de alta prioridade',
  risk_case_critical: 'Caso antifraude crítico',
  account_deletion_failed: 'Falha na exclusão de conta',
});

export const ADMIN_ALERT_ACTIONS = Object.freeze({
  review_support_ticket: 'ABRIR TICKETS',
  review_ride_dispute: 'ABRIR DISPUTAS',
  review_payment: 'ABRIR PAINEL',
  review_risk_case: 'ABRIR ANTIFRAUDE',
  review_account_deletion: 'ABRIR PAINEL',
});

export const ADMIN_ALERT_RESOLUTIONS = Object.freeze({
  action_completed: 'Ação concluída',
  source_resolved: 'Fonte resolvida',
  duplicate_alert: 'Alerta duplicado',
  false_positive: 'Falso positivo',
  reviewed_no_action: 'Revisado, sem ação necessária',
});

export function adminAlertTitle(code) {
  return ADMIN_ALERT_TITLES[code] || 'Alerta operacional';
}

export function shortAdminAlertReference(value) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= 14) return text;
  return `${text.slice(0, 6)}…${text.slice(-5)}`;
}
