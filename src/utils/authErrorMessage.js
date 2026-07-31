const ROLE_LABELS = {
  admin: 'equipe interna',
  driver: 'motorista',
  passenger: 'passageiro',
};

const AUTH_CONFIGURATION_CODES = new Set([
  'auth/operation-not-allowed',
  'auth/configuration-not-found',
]);

function codeOf(error) {
  return String(error?.code || '').trim().toLowerCase();
}

function isCredentialError(code) {
  return (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  );
}

export function authDiagnosticCode(error) {
  const code = codeOf(error);

  if (AUTH_CONFIGURATION_CODES.has(code)) return 'AUTH-CONFIG';
  if (code === 'auth/app-not-authorized') return 'AUTH-APP';
  if (code === 'auth/invalid-api-key') return 'AUTH-KEY';
  if (code === 'auth/network-request-failed' || code === 'unavailable') return 'AUTH-NET';
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return 'DB-RULES';
  if (code === 'failed-precondition' || code === 'firestore/failed-precondition') return 'DB-CONFIG';
  if (code === 'auth/internal-error' || code === 'internal') return 'AUTH-INTERNAL';
  return 'AUTH-UNKNOWN';
}

function infrastructureMessage(error) {
  const code = codeOf(error);
  const diagnostic = authDiagnosticCode(error);

  if (AUTH_CONFIGURATION_CODES.has(code)) {
    return `O cadastro por e-mail está indisponível nesta versão. Código: ${diagnostic}.`;
  }

  if (code === 'auth/app-not-authorized') {
    return `Esta versão do aplicativo não está autorizada para acessar o serviço. Código: ${diagnostic}.`;
  }

  if (code === 'auth/invalid-api-key') {
    return `A configuração de acesso do aplicativo é inválida. Código: ${diagnostic}.`;
  }

  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return `A conta foi autenticada, mas o perfil não pôde ser salvo. Código: ${diagnostic}.`;
  }

  if (code === 'failed-precondition' || code === 'firestore/failed-precondition') {
    return `O serviço de cadastro ainda não está configurado corretamente. Código: ${diagnostic}.`;
  }

  if (code === 'auth/network-request-failed' || code === 'unavailable') {
    return `Sem conexão com o servidor. Verifique sua internet e tente novamente. Código: ${diagnostic}.`;
  }

  if (code === 'auth/internal-error' || code === 'internal') {
    return `O serviço de acesso apresentou uma falha temporária. Tente novamente. Código: ${diagnostic}.`;
  }

  return null;
}

export function registrationErrorMessage(error) {
  const code = codeOf(error);

  if (code === 'auth/invalid-email') {
    return 'Informe um e-mail válido.';
  }

  if (code === 'auth/weak-password') {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }

  if (code === 'auth/email-already-in-use' || isCredentialError(code)) {
    return 'Este e-mail já possui uma conta. Digite a senha correta ou use a opção Entrar.';
  }

  if (code === 'auth/user-disabled') {
    return 'Esta conta está desativada. Entre em contato com o suporte.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  }

  if (code === 'auth/account-role-conflict') {
    const existingRole = ROLE_LABELS[error?.existingRole] || 'outro tipo';
    return `Este e-mail já está vinculado a uma conta de ${existingRole}. Entre com essa conta ou use outro e-mail.`;
  }

  const infrastructure = infrastructureMessage(error);
  if (infrastructure) return infrastructure;

  return `Não foi possível concluir o acesso. Código: ${authDiagnosticCode(error)}.`;
}

export function loginErrorMessage(error) {
  const code = codeOf(error);

  if (code === 'auth/invalid-email') {
    return 'Informe um e-mail válido.';
  }

  if (isCredentialError(code)) {
    return 'E-mail ou senha incorretos.';
  }

  if (code === 'auth/user-disabled') {
    return 'Esta conta está desativada. Entre em contato com o suporte.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  }

  const infrastructure = infrastructureMessage(error);
  if (infrastructure) return infrastructure;

  return `Não foi possível entrar agora. Código: ${authDiagnosticCode(error)}.`;
}
