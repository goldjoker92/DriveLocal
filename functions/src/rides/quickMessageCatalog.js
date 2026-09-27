// @ts-check
// Server-authoritative quick-message vocabulary. Clients send codes only; visible
// PT-BR copy is resolved here. Free-text messages have a separate endpoint and
// never enter notification payloads. Legacy-compatible codes stay unchanged.

const QUICK_MESSAGE_HISTORY_LIMIT = 6;
const QUICK_MESSAGE_RATE_LIMIT_MS = 5 * 1000;
const QUICK_MESSAGE_RETENTION_MS = 2 * 60 * 60 * 1000;

const QUICK_MESSAGES = Object.freeze({
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
  driver_cannot_find_passenger: Object.freeze({
    senderRole: 'driver',
    statuses: Object.freeze(['driver_arrived']),
    requiresMessagingV1: true,
    text: 'Não estou vendo você.',
  }),
  driver_where_waiting: Object.freeze({
    senderRole: 'driver',
    statuses: Object.freeze(['assigned', 'driver_arrived']),
    requiresMessagingV1: true,
    text: 'Onde você está esperando?',
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

function quickMessageDefinition(messageCode) {
  return QUICK_MESSAGES[String(messageCode || '')] || null;
}

function isQuickMessageAllowed(senderRole, rideStatus, messageCode) {
  const definition = quickMessageDefinition(messageCode);
  return Boolean(
    definition
    && definition.senderRole === senderRole
    && definition.statuses.includes(String(rideStatus || ''))
  );
}

function quickMessagePresentation(messageCode) {
  const definition = quickMessageDefinition(messageCode);
  if (!definition) {
    return {
      title: 'Mensagem da corrida',
      body: 'Abra a DriveLocal para ver a atualização.',
    };
  }
  return {
    title: definition.senderRole === 'driver'
      ? 'Mensagem do motorista'
      : 'Mensagem do passageiro',
    body: definition.text,
  };
}

module.exports = {
  QUICK_MESSAGES,
  QUICK_MESSAGE_HISTORY_LIMIT,
  QUICK_MESSAGE_RATE_LIMIT_MS,
  QUICK_MESSAGE_RETENTION_MS,
  quickMessageDefinition,
  isQuickMessageAllowed,
  quickMessagePresentation,
};
