import {
  DRIVER_ARRIVAL_CONFIRMATION_VERSION,
  driverArrivalConfirmationCopy,
  safeArrivalPassengerFirstName,
} from '../driverArrivalNotification';

describe('driver arrival notification confirmation copy', () => {
  it('personalizes the confirmation with the safe passenger first name', () => {
    expect(driverArrivalConfirmationCopy({
      acceptedPassengerPublic: { firstName: 'Maria Silva' },
    })).toEqual({
      firstName: 'Maria',
      title: 'Maria recebeu o aviso de chegada',
      message: 'A tela do passageiro já mostra que você chegou ao local de embarque.',
      deliveryNote: 'Se as notificações estiverem ativadas no telefone, o aviso “Motorista chegou” também aparecerá fora do aplicativo.',
      offlineNote: 'Sua chegada continua registrada mesmo se o passageiro estiver sem notificações ou com a rede lenta.',
    });
  });

  it('uses a privacy-safe fallback for malformed or email-like names', () => {
    expect(safeArrivalPassengerFirstName('driver@example.com')).toBe('Passageiro');
    expect(safeArrivalPassengerFirstName('')).toBe('Passageiro');
    expect(driverArrivalConfirmationCopy({}).title)
      .toBe('Passageiro recebeu o aviso de chegada');
  });

  it('keeps the presentation contract version explicit', () => {
    expect(DRIVER_ARRIVAL_CONFIRMATION_VERSION)
      .toBe('driver-arrival-confirmation-v1');
  });
});
