export const DRIVER_ARRIVAL_CONFIRMATION_VERSION = 'driver-arrival-confirmation-v1';

export function safeArrivalPassengerFirstName(value) {
  const text = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  if (!text || text.includes('@')) return 'Passageiro';
  return (text.split(' ')[0] || 'Passageiro').slice(0, 40);
}

export function driverArrivalConfirmationCopy(offer = {}) {
  const firstName = safeArrivalPassengerFirstName(
    offer?.acceptedPassengerPublic?.firstName
  );

  return Object.freeze({
    firstName,
    title: `${firstName} recebeu o aviso de chegada`,
    message: 'A tela do passageiro já mostra que você chegou ao local de embarque.',
    deliveryNote: 'Se as notificações estiverem ativadas no telefone, o aviso “Motorista chegou” também aparecerá fora do aplicativo.',
    offlineNote: 'Sua chegada continua registrada mesmo se o passageiro estiver sem notificações ou com a rede lenta.',
  });
}
