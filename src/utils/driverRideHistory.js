import { formatBRL } from './format';

export const DRIVER_RIDE_HISTORY_VERSION = 'driver-ride-history-v1';
export const DRIVER_HISTORY_TIME_ZONE = 'America/Fortaleza';

const RIDE_STATUS = Object.freeze({
  assigned: { label: 'Motorista a caminho', tone: 'info' },
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
  sent_by_passenger: { label: 'Passageiro informou o envio', tone: 'warning' },
  received: { label: 'Pix recebido', tone: 'success' },
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

export function formatDriverHistoryDateTime(timestampMs) {
  const timestamp = Number(timestampMs);
  if (!(timestamp > 0)) return 'Data indisponível';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: DRIVER_HISTORY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDriverCommissionBps(value) {
  const bps = Number(value);
  if (![0, 1200, 1500].includes(bps)) return 'Comissão indisponível';
  return `Comissão ${String(bps / 100).replace('.', ',')}%`;
}

export function formatDriverRateBps(value) {
  const bps = Number(value);
  if (!Number.isFinite(bps) || bps < 0) return '—';
  const percent = Math.max(0, Math.min(100, bps / 100));
  const decimals = Number.isInteger(percent) ? 0 : 1;
  return `${percent.toFixed(decimals).replace('.', ',')}%`;
}

export function normalizeDriverHistoryItem(raw = {}) {
  const rideId = safeRideId(raw.rideId);
  if (!rideId) return null;
  const ride = RIDE_STATUS[raw.rideStatus] || { label: 'Status indisponível', tone: 'muted' };
  const pix = PIX_STATUS[raw.pixStatus] || PIX_STATUS.not_started;
  const fareCentavos = nonNegativeInteger(raw.fareCentavos);
  const fareKind = raw.fareKind === 'final'
    ? 'final'
    : raw.fareKind === 'estimated'
      ? 'estimated'
      : 'unavailable';
  const commissionBps = [0, 1200, 1500].includes(Number(raw.commissionBps))
    ? Number(raw.commissionBps)
    : null;
  const vehicleType = raw.vehicleType === 'moto' ? 'moto' : raw.vehicleType === 'car' ? 'car' : null;
  const historyAtMs = nonNegativeInteger(raw.historyAtMs) || nonNegativeInteger(raw.acceptedAtMs);

  return Object.freeze({
    rideId,
    historyAtMs,
    dateLabel: formatDriverHistoryDateTime(historyAtMs),
    passengerFirstName: safeText(raw.passengerFirstName, 'Passageiro', 40),
    pickupLabel: safeText(raw.pickupLabel, 'Local de partida'),
    destinationLabel: safeText(raw.destinationLabel, 'Destino'),
    vehicleType,
    vehicleLabel: vehicleType === 'moto' ? '🏍 Moto' : vehicleType === 'car' ? '🚗 Carro' : 'Veículo',
    fareCentavos,
    fareLabel: fareCentavos == null ? 'Valor indisponível' : formatBRL(fareCentavos),
    fareDetail: fareKind === 'estimated' ? 'valor estimado' : fareKind === 'final' ? 'valor final' : null,
    commissionBps,
    commissionLabel: formatDriverCommissionBps(commissionBps),
    rideStatus: raw.rideStatus || 'unknown',
    rideStatusLabel: ride.label,
    rideStatusTone: ride.tone,
    pixStatus: raw.pixStatus || 'not_started',
    pixStatusLabel: pix.label,
    pixStatusTone: pix.tone,
  });
}

export function normalizeDriverHistoryPage(snapshot = {}) {
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(snapshot.items) ? snapshot.items : []) {
    const item = normalizeDriverHistoryItem(raw);
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

export function appendDriverHistoryPages(currentItems, nextItems) {
  const map = new Map();
  for (const item of [...(currentItems || []), ...(nextItems || [])]) {
    if (item?.rideId) map.set(item.rideId, item);
  }
  return [...map.values()].sort((left, right) => Number(right.historyAtMs || 0) - Number(left.historyAtMs || 0));
}
