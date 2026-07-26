export const DRIVER_ACTIVE_RIDE_SCREEN_VERSION = 'driver-active-ride-screen-v1';

const STAGES = Object.freeze({
  assigned: {
    index: 1,
    total: 4,
    label: 'A caminho do embarque',
    helper: 'Navegue até o local exato e confirme somente quando chegar.',
  },
  driver_arrived: {
    index: 2,
    total: 4,
    label: 'Aguardando o passageiro',
    helper: 'Confirme o embarque somente quando o passageiro estiver no veículo.',
  },
  in_progress: {
    index: 3,
    total: 4,
    label: 'Em direção ao destino',
    helper: 'Siga a navegação e finalize somente ao concluir a corrida.',
  },
  awaiting_payment: {
    index: 4,
    total: 4,
    label: 'Aguardando o Pix',
    helper: 'Confira sua conta antes de confirmar o recebimento.',
  },
  payment_marked_sent: {
    index: 4,
    total: 4,
    label: 'Pix informado pelo passageiro',
    helper: 'O passageiro informou o pagamento. Confirme somente após verificar sua conta.',
  },
  disputed: {
    index: 4,
    total: 4,
    label: 'Pagamento em análise',
    helper: 'O valor permanece registrado para conferência e suporte.',
  },
  completed: {
    index: 4,
    total: 4,
    label: 'Corrida concluída',
    helper: 'Pagamento confirmado e corrida encerrada.',
  },
});

const ACTIONS = Object.freeze({
  assigned: {
    key: 'arrive',
    label: 'CHEGUEI AO LOCAL',
    pendingLabel: 'ENVIANDO…',
    requires: 'pickup',
  },
  driver_arrived: {
    key: 'start',
    label: 'PASSAGEIRO EMBARCOU',
    pendingLabel: 'ENVIANDO…',
    requires: null,
  },
  in_progress: {
    key: 'finish',
    label: 'FINALIZAR CORRIDA',
    pendingLabel: 'ENVIANDO…',
    requires: 'destination',
  },
  awaiting_payment: {
    key: 'confirm',
    label: 'PAGAMENTO RECEBIDO',
    pendingLabel: 'CONFIRMANDO…',
    requires: 'paymentPayload',
  },
  payment_marked_sent: {
    key: 'confirm',
    label: 'PAGAMENTO RECEBIDO',
    pendingLabel: 'CONFIRMANDO…',
    requires: 'paymentPayload',
  },
});

function requirementAvailable(requirement, input) {
  if (!requirement) return true;
  if (requirement === 'pickup') return Boolean(input.hasPickup);
  if (requirement === 'destination') return Boolean(input.hasDestination);
  if (requirement === 'paymentPayload') return Boolean(input.hasPaymentPayload);
  return false;
}

export function deriveDriverActiveRideStage(status) {
  return STAGES[status] || {
    index: 0,
    total: 4,
    label: 'Atualizando a corrida',
    helper: 'Aguarde a confirmação do estado da corrida.',
  };
}

export function deriveDriverActiveRidePrimaryAction({
  status,
  busy = '',
  hasPickup = false,
  hasDestination = false,
  hasPaymentPayload = false,
} = {}) {
  const definition = ACTIONS[status];
  if (!definition) return null;
  const available = requirementAvailable(definition.requires, {
    hasPickup,
    hasDestination,
    hasPaymentPayload,
  });
  const pending = busy === definition.key;

  return {
    ...definition,
    title: pending ? definition.pendingLabel : definition.label,
    disabled: Boolean(busy) || !available,
    pending,
    unavailableReason: available ? null : `${definition.requires}_missing`,
  };
}

export function deriveDriverActiveRideNavigation({ status, pickup, destination } = {}) {
  if (status === 'assigned' || status === 'driver_arrived') {
    return {
      kind: 'pickup',
      title: 'Navegar até o embarque',
      point: pickup || null,
    };
  }
  if (status === 'in_progress') {
    return {
      kind: 'destination',
      title: 'Navegar até o destino',
      point: destination || null,
    };
  }
  return null;
}

export function driverActiveRideNavigationMode(vehicleType) {
  return vehicleType === 'moto'
    ? { google: 'two-wheeler', waze: 'motorcycle', label: 'Modo moto' }
    : { google: 'driving', waze: 'private', label: 'Modo carro' };
}
