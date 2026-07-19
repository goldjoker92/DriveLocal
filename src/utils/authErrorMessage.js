const ROLE_LABELS = {
  admin: 'equipe interna',
  driver: 'motorista',
  passenger: 'passageiro',
};

export function registrationErrorMessage(error) {
  const code = error?.code || '';

  if (code === 'auth/invalid-email') {
    return 'Informe um e-mail válido.';
  }

  if (code === 'auth/weak-password') {
    return 'A senha deve ter pelo menos 6 caracteres.';
  }

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'Este e-mail já possui uma conta. Digite a senha correta ou use a opção Entrar.';
  }

  if (code === 'auth/too-many-requests') {
    return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
  }

  if (code === 'auth/account-role-conflict') {
    const existingRole = ROLE_LABELS[error?.existingRole] || 'outro tipo';
    return `Este e-mail já está vinculado a uma conta de ${existingRole}. Entre com essa conta ou use outro e-mail.`;
  }

  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'A conta foi autenticada, mas o perfil não pôde ser salvo. Tente novamente.';
  }

  if (code === 'auth/network-request-failed' || code === 'unavailable') {
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
  }

  return 'Não foi possível concluir o acesso. Verifique o e-mail e a senha e tente novamente.';
}
