// Stable cancellation codes shared by the mobile UI. Labels are presentation only;
// Cloud Functions validates every code again according to the authenticated role.

export const PASSENGER_NO_SHOW_WAIT_MS = 3 * 60 * 1000;

export const DRIVER_CANCELLATION_REASONS = Object.freeze([
  { code: 'passenger_no_show', label: 'Passageiro não apareceu', noShow: true },
  { code: 'pickup_address_incorrect', label: 'Endereço incorreto' },
  { code: 'unsafe_pickup', label: 'Local inseguro' },
  { code: 'vehicle_problem', label: 'Problema com o veículo' },
  { code: 'driver_other', label: 'Outro motivo' },
]);

export const PASSENGER_CANCELLATION_REASONS = Object.freeze([
  { code: 'no_longer_needed', label: 'Não preciso mais da corrida' },
  { code: 'driver_delayed', label: 'Motorista demorando' },
  { code: 'driver_not_moving', label: 'Motorista não se move' },
  { code: 'driver_or_vehicle_mismatch', label: 'Veículo ou motorista diferente' },
  { code: 'passenger_safety_concern', label: 'Problema de segurança' },
  { code: 'passenger_other', label: 'Outro motivo' },
]);

const DRIVER_CODES = new Set(DRIVER_CANCELLATION_REASONS.map((reason) => reason.code));
const PASSENGER_CODES = new Set(PASSENGER_CANCELLATION_REASONS.map((reason) => reason.code));

export function normalizeCancellationReason(reasonCode, role) {
  const code = String(reasonCode || '').trim();
  if (role === 'driver') {
    if (DRIVER_CODES.has(code)) return code;
    if (code === 'motorista_cancelou') return 'driver_other';
  }
  if (role === 'passenger') {
    if (PASSENGER_CODES.has(code)) return code;
    if (code === 'passageiro_cancelou') return 'passenger_other';
  }
  return code;
}

export function noShowRemainingMs(driverArrivedAtMs, nowMs = Date.now()) {
  const arrivedAt = Number(driverArrivedAtMs || 0);
  if (!Number.isFinite(arrivedAt) || arrivedAt <= 0) return PASSENGER_NO_SHOW_WAIT_MS;
  return Math.max(0, arrivedAt + PASSENGER_NO_SHOW_WAIT_MS - Number(nowMs));
}

export function formatWaitDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}