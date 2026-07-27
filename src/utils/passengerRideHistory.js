import { formatBRL } from './format';

export const PASSENGER_RIDE_HISTORY_VERSION = 'passenger-ride-history-v1';
export const PASSENGER_HISTORY_TIME_ZONE = 'America/Fortaleza';

const RIDE_STATUS = Object.freeze({
  searching: { label: 'Buscando motorista', tone: 'info' },
  assigned: { label: 'Motorista a caminho', tone: 'info' },
  no_driver_available: { label: 'Nenhum motorista disponível', tone: 'muted' },
  dispatch_failed: { label: 'Busca não concluída', tone: 'warning' },
  driver_arrived: { label: 'Motorista chegou', tone: 'info' },
  in_progress: { label: 'Em andamento', tone: 'info' },
  awaiting_payment: { label: 'Aguardando Pix', tone: 'warning' },
  payment_marked_sent: { label: 'Pix informado', tone: 'warning' },
  completed: { label: 'Concluída', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
  disputed: { label: 'Em análise', tone: 'warning' },
});

const PIX_STATUS = Object.freeze({
  not_started: { label: 'Pix ainda não iniciado', tone: 'muted' },
  awaiting_payment: { label: 'Aguardando pagamento', tone: 'warning' },
  sent_by_passenger: { label: 'Envio informado', tone: 'warning' },
  received: { label: 'Pix confirmado', tone: 'success' },
  disputed: { label: 'Pagamento em análise', tone: 'warning' },
  not_applicable: { label: 'Pix não aplicável', tone: 'muted' },
});

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

function safeText(value, fallback, max = 72) {
  const text = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  return (text || fallback).slice(0, max);
}

function safeRideId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, 120) : null;
}

export function formatPassengerHistoryDateTime(timestampMs) {
  const timestamp = Number(timestampMs);
  if (!(timestamp > 0)) return 'Data indisponível';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: PASSENGER_HISTORY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function normalizePassengerHistoryItem(raw = {}) {
  const rideId = safeRideId(raw.rideId);
  if (!rideId) return null;
  const ride = RIDE_STATUS[raw.rideStatus] || { label: 'Status indisponível', tone: 'muted' };
  const pix = PIX_STATUS[raw.pixStatus] || PIX_STATUS.not_started;
  const amountCentavos = nonNegativeInteger(raw.amountCentavos);
  const amountKind = raw.amountKind === 'final'
    ? 'final'
    : raw.amountKind === 'estimated'
      ? 'estimated'
      : 'unavailable';
  const vehicleType = raw.vehicleType === 'moto' ? 'moto' : raw.vehicleType === 'car' ? 'car' : null;
  const historyAtMs = nonNegativeInteger(raw.historyAtMs) || nonNegativeInteger(raw.createdAtMs);

  return Object.freeze({
    rideId,
    createdAtMs: nonNegativeInteger(raw.createdAtMs),
    historyAtMs,
    dateLabel: formatPassengerHistoryDateTime(historyAtMs),
    driverFirstName: safeText(raw.driverFirstName, 'Motorista não atribuído', 40),
    pickupLabel: safeText(raw.pickupLabel, 'Local de partida'),
    destinationLabel: safeText(raw.destinationLabel, 'Destino'),
    vehicleType,
    vehicleLabel: safeText(
      raw.vehicleLabel,
      vehicleType === 'moto' ? 'Moto' : vehicleType === 'car' ? 'Carro' : 'Veículo',
      96
    ),
    amountCentavos,
    amountLabel: amountCentavos == null ? 'Valor indisponível' : formatBRL(amountCentavos),
    amountDetail: amountKind === 'estimated'
      ? 'valor estimado'
      : amountKind === 'final'
        ? 'valor final'
        : null,
    rideStatus: raw.rideStatus || 'unknown',
    rideStatusLabel: ride.label,
    rideStatusTone: ride.tone,
    pixStatus: raw.pixStatus || 'not_started',
    pixStatusLabel: pix.label,
    pixStatusTone: pix.tone,
  });
}

export function normalizePassengerHistoryPage(snapshot = {}) {
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(snapshot.items) ? snapshot.items : []) {
    const item = normalizePassengerHistoryItem(raw);
    if (!item || seen.has(item.rideId)) continue;
    seen.add(item.rideId);
    items.push(item);
  }
  return Object.freeze({
    version: snapshot.version || null,
    items,
    nextCursor: snapshot.nextCursor || null,
    hasMore: snapshot.hasMore === true && Boolean(snapshot.nextCursor),
  });
}

export function appendPassengerHistoryPages(currentItems, nextItems) {
  const map = new Map();
  for (const item of [...(currentItems || []), ...(nextItems || [])]) {
    if (item?.rideId) map.set(item.rideId, item);
  }
  return [...map.values()].sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));
}