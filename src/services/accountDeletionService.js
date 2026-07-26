import {
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

import { auth, functions } from '../config/firebase';

function shortRef(value) {
  const text = String(value || '');
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function traceAccountDeletion(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[ACCOUNT_DELETION] ${event}`, {
    scope: 'account_deletion',
    event,
    atMs: Date.now(),
    ...details,
  });
}

export async function requestAccountDeletion(password) {
  const user = auth.currentUser;
  if (!user || !user.email) {
    const error = new Error('ACCOUNT_NOT_AUTHENTICATED');
    error.code = 'auth/unauthenticated';
    throw error;
  }
  if (!String(password || '').trim()) {
    const error = new Error('PASSWORD_REQUIRED');
    error.code = 'auth/password-required';
    throw error;
  }

  traceAccountDeletion('reauthentication.requested');
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
  // Force a fresh ID token so the server can verify auth_time rather than trusting
  // the fact that the client says a password was entered.
  await user.getIdToken(true);
  traceAccountDeletion('reauthentication.succeeded');

  const requestDeletion = httpsCallable(functions, 'requestAccountDeletionSecure');
  traceAccountDeletion('request.started');
  try {
    const response = await requestDeletion({ confirmation: 'EXCLUIR' });
    const result = response?.data || {};
    traceAccountDeletion('request.succeeded', {
      requestRef: shortRef(result.requestRef),
      status: result.status || 'requested',
      replay: result.replay === true,
    });
    return {
      accepted: result.accepted === true,
      requestRef: result.requestRef || null,
      status: result.status || 'requested',
      replay: result.replay === true,
    };
  } catch (error) {
    traceAccountDeletion('request.failed', {
      code: error?.code || 'unknown',
      reason: error?.details?.metadata?.reason
        || error?.details?.reason
        || null,
    }, 'warn');
    throw error;
  }
}

export function accountDeletionErrorMessage(error) {
  const code = String(error?.code || '');
  const reason = error?.details?.metadata?.reason
    || error?.details?.reason
    || error?.details?.data?.metadata?.reason
    || null;

  if (code === 'auth/password-required') return 'Digite sua senha atual para continuar.';
  if (['auth/wrong-password', 'auth/invalid-credential'].includes(code)) {
    return 'Senha incorreta. Verifique e tente novamente.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }
  if (reason === 'ACTIVE_RIDE_PRESENT') {
    return 'Finalize ou cancele sua corrida ativa antes de excluir a conta.';
  }
  if (reason === 'RECENT_LOGIN_REQUIRED' || code === 'auth/requires-recent-login') {
    return 'Entre novamente na conta e repita a solicitação.';
  }
  if (reason === 'ACCOUNT_PROFILE_AMBIGUOUS') {
    return 'Não foi possível validar seu perfil. Entre em contato com o suporte.';
  }
  return 'Não foi possível registrar a exclusão agora. Tente novamente.';
}
