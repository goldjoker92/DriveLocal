const ROLE_LABELS = {
  admin: 'equipe interna',
  driver: 'motorista',
  passenger: 'passageiro',
};

const AUTH_CONFIGURATION_CODES = new Set([
  'auth/operation-not-allowed',
  'auth/configuration-not-found',
  'auth/app-not-authorized',
  'auth/invalid-api-key',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
]);

function isCredentialError(code) {
  return (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  );
}

function isNetworkError(code) {
  return (
    code === 'auth/network-request-failed' ||
    code === 'unavailable' ||
    code === 'firestore/unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'firestore/deadline-exceeded'
  );
}

function isAuthConfigurationError(code) {
  return AUTH_CONFIGURATION_CODES.has(code);
}

export function registrationErrorMessage(error) {
  const code = error?.code || '';

  if (code === 'auth/invalid-email') {
    return 'Informe um e-mail válido.';
  }

  if (code === 'auth/missing-password') {
    return 'Informe uma senha.';
  }

  if (code === 'auth/weak-password') {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }

  if (isCredentialError(code)) {
    return 'Este e-mail já possui uma conta. Digite a senha correta ou use a opção Entrar.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  }

  if (code === 'auth/email-already-in-use') {
    return 'Este e-mail já possui uma conta. Use a opção Entrar.';
  }

  if (code === 'auth/account-role-conflict') {
    const existingRole = ROLE_LABELS[error?.existingRole] || 'outro tipo';
    return `Este e-mail já está vinculado a uma conta de ${existingRole}. Entre com essa conta ou use outro e-mail.`;
  }

  if (code === 'auth/registration-session-mismatch') {
    return 'A sessão mudou durante o cadastro. Volte e tente novamente. Código: AUTH-SESSION.';
  }

  if (code === 'auth/profile-provisioning-failed') {
    return 'Sua conta foi preservada, mas o perfil não foi concluído agora. Toque em Continuar novamente com o mesmo e-mail e senha. Código: PROFILE-RETRY.';
  }

  if (isAuthConfigurationError(code)) {
    return 'O acesso por e-mail está temporariamente indisponível. Código: AUTH-PROD-CONFIG.';
  }

  // Raw Firestore authorization errors should normally be absorbed by the
  // registration reconciliation flow. Keep a recoverable message as a final
  // safety net without telling the user to create another account.
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'Não foi possível confirmar seu perfil agora. Tente novamente com o mesmo e-mail e senha. Código: PROFILE-RETRY.';
  }

  if (isNetworkError(code)) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
  }

  if (code === 'auth/internal-error' || code === 'internal') {
    return 'O servidor de acesso encontrou um erro temporário. Código: AUTH-INTERNAL.';
  }

  return 'Não foi possível concluir o acesso agora. Código: AUTH-UNKNOWN.';
}

export function loginErrorMessage(error) {
  const code = error?.code || '';

  if (code === 'auth/invalid-email') {
    return 'Informe um e-mail válido.';
  }

  if (isCredentialError(code)) {
    return 'E-mail ou senha incorretos.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  }

  if (isAuthConfigurationError(code)) {
    return 'O acesso por e-mail está temporariamente indisponível. Código: AUTH-PROD-CONFIG.';
  }

  if (isNetworkError(code)) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
  }

  if (code === 'auth/internal-error' || code === 'internal') {
    return 'O servidor de acesso encontrou um erro temporário. Código: AUTH-INTERNAL.';
  }

  return 'Não foi possível entrar agora. Código: AUTH-UNKNOWN.';
}

export const __authErrorMessageInternals = {
  isCredentialError,
  isNetworkError,
  isAuthConfigurationError,
};
