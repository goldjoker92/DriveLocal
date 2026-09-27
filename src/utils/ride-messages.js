import { quickMessageText } from '../constants/rideQuickMessages';

export const MESSAGE_MAX_LENGTH = 280;
export const messagePhaseOpen = (status) => ['assigned', 'driver_arrived'].includes(status);
export const conversationRoute = (role) => role === 'driver' ? '/driver-ride-messages' : '/passenger-ride-messages';
export const displayedMessage = (message) => message.kind === 'text' ? message.text : quickMessageText(message.messageCode);
export const messageLength = (text) => [...String(text || '').normalize('NFC').trim()].length;

export function messageFailure(error) {
  const reason = error?.details?.metadata?.reason;
  const remainingMs = Number(error?.details?.metadata?.remainingMs);
  if (remainingMs > 0) return `Aguarde ${Math.ceil(remainingMs / 1000)} segundo(s) e tente novamente.`;
  if (reason === 'MESSAGE_CLOSED' || reason === 'QUICK_MESSAGE_NOT_ALLOWED') return 'O embarque já terminou. A conversa agora é somente para consulta.';
  if (reason === 'MESSAGE_PEER_NOT_READY') return 'O texto livre estará disponível quando a outra pessoa abrir esta corrida na versão atualizada. Use as respostas rápidas por enquanto.';
  if (reason === 'MESSAGE_INVALID_TEXT') return 'Escreva uma mensagem de até 280 caracteres.';
  if (String(error?.code || '').includes('permission-denied') || error?.details?.code === 'FORBIDDEN') return 'Esta conversa não está disponível para esta conta.';
  return 'Não foi possível confirmar o envio. Seu texto foi mantido. Tente novamente com a mesma mensagem para evitar duplicatas.';
}

// A failed/uncertain request retains its key until success or an explicit edit.
// A synchronous lock in the screen prevents two taps from creating two attempts.
export function messageAttempt(previous, content, createKey) {
  if (previous && previous.text === content.text && previous.messageCode === content.messageCode) return previous;
  return { ...content, idempotencyKey: createKey() };
}
