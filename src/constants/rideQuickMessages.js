// Client labels mirror the server-authoritative catalog. The backend remains the
// authority for role/status validation and resolves notification text independently.

export const QUICK_MESSAGE_HISTORY_LIMIT = 6;

export const RIDE_QUICK_MESSAGES = Object.freeze({
  driver_arriving: Object.freeze({
    senderRole: 'driver',
    statuses: Object.freeze(['assigned']),
    text: 'Estou chegando ao local.',
  }),
  driver_traffic_delay: Object.freeze({
    senderRole: 'driver',
    statuses: Object.freeze(['assigned']),
    text: 'O trânsito está mais lento que o previsto.',
  }),
  driver_at_pickup: Object.freeze({
    senderRole: 'driver',
    statuses: Object.freeze(['driver_arrived']),
    text: 'Estou no local indicado.',
  }),
  driver_cannot_stop_here: Object.freeze({
    senderRole: 'driver',
    statuses: Object.freeze(['driver_arrived']),
    text: 'Não consigo parar exatamente no ponto. Procure o veículo próximo.',
  }),
  passenger_waiting: Object.freeze({
    senderRole: 'passenger',
    statuses: Object.freeze(['assigned', 'driver_arrived']),
    text: 'Estou aguardando no local indicado.',
  }),
  passenger_coming: Object.freeze({
    senderRole: 'passenger',
    statuses: Object.freeze(['driver_arrived']),
    text: 'Estou indo ao encontro do veículo.',
  }),
  passenger_needs_minute: Object.freeze({
    senderRole: 'passenger',
    statuses: Object.freeze(['driver_arrived']),
    text: 'Preciso de mais um minuto.',
  }),
  passenger_cannot_find_vehicle: Object.freeze({
    senderRole: 'passenger',
    statuses: Object.freeze(['driver_arrived']),
    text: 'Não encontrei o veículo.',
  }),
});

export function quickMessageOptions(senderRole, rideStatus) {
  return Object.entries(RIDE_QUICK_MESSAGES)
    .filter(([, definition]) =>
      definition.senderRole === senderRole
      && definition.statuses.includes(String(rideStatus || ''))
    )
    .map(([code, definition]) => ({ code, text: definition.text }));
}

export function quickMessageText(messageCode) {
  return RIDE_QUICK_MESSAGES[String(messageCode || '')]?.text || 'Atualização da corrida.';
}

export function quickMessageSenderLabel(senderRole) {
  return senderRole === 'driver' ? 'Motorista' : 'Passageiro';
}
