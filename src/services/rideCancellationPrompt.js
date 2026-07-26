import { Alert } from 'react-native';

import {
  DRIVER_CANCELLATION_REASONS,
  PASSENGER_CANCELLATION_REASONS,
} from '../constants/rideCancellation';

function labelFor(reasons, code) {
  return reasons.find((reason) => reason.code === code)?.label || 'Outro motivo';
}

function choosePair({ title, reasons, firstCode, secondCode }) {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      'Selecione o motivo que melhor descreve a situação.',
      [
        { text: labelFor(reasons, firstCode), onPress: () => resolve(firstCode) },
        { text: labelFor(reasons, secondCode), onPress: () => resolve(secondCode) },
        { text: 'Manter corrida', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: false },
    );
  });
}

async function chooseDriverReason() {
  const category = await new Promise((resolve) => {
    Alert.alert(
      'Por que cancelar?',
      '“Passageiro não apareceu” fica disponível separadamente após o tempo mínimo de espera. Toque fora para manter a corrida.',
      [
        { text: 'Local de embarque', onPress: () => resolve('pickup') },
        { text: 'Segurança ou veículo', onPress: () => resolve('operation') },
        { text: 'Outro motivo', onPress: () => resolve('driver_other') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });

  if (category === 'driver_other') return category;
  if (category === 'pickup') {
    return choosePair({
      title: 'Problema no embarque',
      reasons: DRIVER_CANCELLATION_REASONS,
      firstCode: 'pickup_address_incorrect',
      secondCode: 'unsafe_pickup',
    });
  }
  if (category === 'operation') {
    return choosePair({
      title: 'Problema operacional',
      reasons: DRIVER_CANCELLATION_REASONS,
      firstCode: 'vehicle_problem',
      secondCode: 'driver_other',
    });
  }
  return null;
}

async function choosePassengerReason() {
  const category = await new Promise((resolve) => {
    Alert.alert(
      'Por que cancelar?',
      'Selecione uma categoria. Nenhuma taxa de cancelamento será cobrada nesta versão. Toque fora para manter a corrida.',
      [
        { text: 'Tempo do motorista', onPress: () => resolve('timing') },
        { text: 'Identidade ou segurança', onPress: () => resolve('safety') },
        { text: 'Mudança de planos', onPress: () => resolve('plans') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });

  if (category === 'timing') {
    return choosePair({
      title: 'Tempo do motorista',
      reasons: PASSENGER_CANCELLATION_REASONS,
      firstCode: 'driver_delayed',
      secondCode: 'driver_not_moving',
    });
  }
  if (category === 'safety') {
    return choosePair({
      title: 'Identidade ou segurança',
      reasons: PASSENGER_CANCELLATION_REASONS,
      firstCode: 'driver_or_vehicle_mismatch',
      secondCode: 'passenger_safety_concern',
    });
  }
  if (category === 'plans') {
    return choosePair({
      title: 'Mudança de planos',
      reasons: PASSENGER_CANCELLATION_REASONS,
      firstCode: 'no_longer_needed',
      secondCode: 'passenger_other',
    });
  }
  return null;
}

export async function chooseCancellationReason(role) {
  if (role === 'driver') return chooseDriverReason();
  if (role === 'passenger') return choosePassengerReason();
  return null;
}