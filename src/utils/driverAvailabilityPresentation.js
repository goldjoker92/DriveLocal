const REASONS = {
  profile_loading: 'Carregando sua situação…',
  server_unconfirmed: 'Aguardando confirmação do servidor. Verifique sua conexão.',
  network_unavailable: 'Sem conexão confirmada. A disponibilidade será verificada quando a internet voltar.',
  local_session_loading: 'Verificando sua sessão de trabalho…',
  device_checking: 'Verificando GPS e notificações do aparelho…',
  location_delayed: 'Sua localização está demorando a atualizar. Estamos verificando sua disponibilidade.',
  location_stale: 'O servidor não recebe uma localização recente. Verifique o GPS e a internet.',
  location_missing: 'Sua posição ainda não foi confirmada pelo servidor.',
  location_unconfirmed: 'Sua primeira posição ainda não foi confirmada.',
  session_stale: 'O servidor perdeu contato com sua sessão de trabalho.',
  session_mismatch: 'A localização não pertence à sessão de trabalho atual.',
  local_session_missing: 'Abra o início para restabelecer sua sessão de trabalho neste aparelho.',
  work_session_lease_expired: 'Sua sessão foi encerrada após perder contato. Comece a trabalhar novamente quando estiver pronto.',
  mandatory_update_required: 'Atualize o DriveLocal na Google Play para voltar a receber ofertas.',
  app_update_required: 'A versão do aplicativo precisa ser atualizada ou confirmada novamente.',
  services_disabled: 'Ative o GPS do telefone para voltar a receber ofertas.',
  foreground_required: 'Autorize sua localização para receber ofertas.',
  foreground_precise_required: 'Autorize a localização precisa nas configurações do telefone.',
  background_required: 'Autorize a localização em segundo plano para continuar disponível.',
  notifications_permission_required: 'Ative as notificações para receber os avisos de novas corridas.',
  notifications_settings_required: 'Ative as notificações nas configurações do telefone.',
  native_task_missing: 'O rastreamento parou. Estamos tentando reiniciá-lo.',
  wallet_low: 'Adicione saldo à carteira para voltar a receber ofertas.',
  pix_invalid: 'Atualize sua chave Pix no perfil para receber ofertas.',
  not_approved: 'Seu cadastro precisa estar aprovado para receber ofertas.',
  blocked: 'Sua disponibilidade está bloqueada. Consulte o suporte.',
  risk_restricted: 'Há uma pendência em análise. Consulte o suporte.',
};
const SETTINGS_REASONS = new Set(['services_disabled', 'foreground_required', 'foreground_precise_required',
  'background_required', 'notifications_permission_required', 'notifications_settings_required']);

export function driverAvailabilityPresentation(status = {}) {
  const { state, reason } = status;
  if (state === 'healthy') return {
    title: 'Disponível para receber solicitações', body: 'Localização confirmada. Aguardando pedidos próximos.',
    tone: 'success', badge: 'Disponível', action: null,
  };
  if (state === 'on_ride') return { title: 'Você está em uma corrida', body: 'Continue pela tela da corrida.', tone: 'success', badge: 'Em corrida', action: null };
  if (state === 'offline') return {
    title: 'Você está indisponível', body: 'Comece quando estiver pronto para receber ofertas.',
    tone: 'neutral', badge: 'Indisponível', action: null,
  };
  let action = 'recover';
  let actionLabel = 'VERIFICAR E REATIVAR';
  if (SETTINGS_REASONS.has(reason)) { action = 'settings'; actionLabel = 'ABRIR CONFIGURAÇÕES'; }
  else if (reason === 'wallet_low') { action = 'wallet'; actionLabel = 'ABRIR CARTEIRA'; }
  else if (reason === 'pix_invalid') { action = 'profile'; actionLabel = 'CORRIGIR CHAVE PIX'; }
  else if (['mandatory_update_required', 'app_update_required'].includes(reason)) { action = 'update'; actionLabel = 'ATUALIZAR APLICATIVO'; }
  else if (['not_approved', 'blocked', 'risk_restricted', 'not_eligible'].includes(reason)) { action = 'support'; actionLabel = 'VER PENDÊNCIA'; }
  else if (['local_session_missing', 'work_session_lease_expired'].includes(reason) || status.workSessionOpen === false) { action = 'home'; actionLabel = 'VOLTAR AO INÍCIO'; }
  const checking = state === 'checking' || state === 'delayed';
  return {
    title: checking ? 'Verificando sua disponibilidade' : 'Você não está recebendo novas corridas',
    body: REASONS[reason] || 'Verifique seu GPS e sua conexão antes de receber novas ofertas.',
    tone: checking ? 'warning' : 'danger', badge: checking ? 'Verificando' : 'Indisponível',
    action, actionLabel,
  };
}
