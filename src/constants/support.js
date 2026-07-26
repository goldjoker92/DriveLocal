// Closed client copy for the minimal support center. The server owns the same
// machine codes and remains authoritative for role/context validation.

export const SUPPORT_STATUS = Object.freeze({
  open: Object.freeze({ label: 'Aberto', tone: 'warning' }),
  in_review: Object.freeze({ label: 'Em análise', tone: 'neutral' }),
  resolved: Object.freeze({ label: 'Resolvido', tone: 'success' }),
  closed: Object.freeze({ label: 'Encerrado', tone: 'neutral' }),
});

export const SUPPORT_RESOLUTIONS = Object.freeze({
  guidance_provided: 'Orientação fornecida',
  payment_under_review: 'Pagamento em análise',
  operation_corrected: 'Operação corrigida',
  no_adjustment_required: 'Nenhum ajuste necessário',
  safety_escalated: 'Caso de segurança encaminhado',
  duplicate_ticket: 'Solicitação duplicada',
  resolved_by_system: 'Resolvido pelo sistema',
});

export const SUPPORT_CATEGORIES = Object.freeze([
  Object.freeze({
    code: 'ride_status_issue',
    label: 'Status da corrida incorreto',
    roles: ['driver', 'passenger'],
    requiresRide: true,
  }),
  Object.freeze({
    code: 'cancellation_issue',
    label: 'Problema com cancelamento',
    roles: ['driver', 'passenger'],
    requiresRide: true,
  }),
  Object.freeze({
    code: 'safety_concern',
    label: 'Problema de segurança',
    roles: ['driver', 'passenger'],
    requiresRide: true,
  }),
  Object.freeze({
    code: 'fare_payment_issue',
    label: 'Problema com o pagamento da corrida',
    roles: ['driver', 'passenger'],
    requiresRide: true,
  }),
  Object.freeze({
    code: 'driver_or_vehicle_mismatch',
    label: 'Motorista ou veículo diferente',
    roles: ['passenger'],
    requiresRide: true,
  }),
  Object.freeze({
    code: 'passenger_no_show_review',
    label: 'Revisar passageiro ausente',
    roles: ['driver'],
    requiresRide: true,
  }),
  Object.freeze({
    code: 'wallet_topup_issue',
    label: 'Problema com recarga do saldo',
    roles: ['driver'],
    requiresRide: false,
  }),
  Object.freeze({
    code: 'subscription_issue',
    label: 'Problema com assinatura',
    roles: ['driver'],
    requiresRide: false,
  }),
  Object.freeze({
    code: 'document_review_issue',
    label: 'Problema com análise de documentos',
    roles: ['driver'],
    requiresRide: false,
  }),
  Object.freeze({
    code: 'account_access_issue',
    label: 'Problema com a conta',
    roles: ['driver', 'passenger'],
    requiresRide: false,
  }),
  Object.freeze({
    code: 'technical_error',
    label: 'Erro técnico no aplicativo',
    roles: ['driver', 'passenger'],
    requiresRide: false,
  }),
]);

export function supportCategoryOptions(role, hasRide) {
  return SUPPORT_CATEGORIES.filter((category) => (
    category.roles.includes(String(role || ''))
    && (!category.requiresRide || hasRide === true)
  ));
}

export function supportCategoryLabel(categoryCode) {
  return SUPPORT_CATEGORIES.find((category) => category.code === categoryCode)?.label
    || 'Solicitação de suporte';
}

export function supportStatusLabel(status) {
  return SUPPORT_STATUS[String(status || '')]?.label || 'Status desconhecido';
}

export function supportResolutionLabel(resolutionCode) {
  return SUPPORT_RESOLUTIONS[String(resolutionCode || '')] || null;
}

export function shortSupportReference(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 14 ? text : `${text.slice(0, 7)}…${text.slice(-5)}`;
}