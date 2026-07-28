// Pure passenger dashboard helpers. Keep this module free of Firebase and React
// Native imports so greeting/history rules remain deterministic and easy to test.

const TERMINAL_RIDE_STATUSES = new Set([
  'completed',
  'cancelled',
  'no_driver_available',
  'dispatch_failed',
]);

const STATUS_LABELS = Object.freeze({
  completed: 'Concluída',
  cancelled: 'Cancelada',
  no_driver_available: 'Sem motorista disponível',
  dispatch_failed: 'Busca não concluída',
});

const VEHICLE_LABELS = Object.freeze({
  moto: 'Moto',
  car: 'Carro',
});

function cleanText(value, maxLength = 120) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, maxLength) : '';
}

function timestampMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  return 0;
}

export function getPassengerFirstName(profile, authUser) {
  const candidates = [
    profile?.fullName,
    profile?.name,
    authUser?.displayName,
  ];

  for (const candidate of candidates) {
    const name = cleanText(candidate, 80);
    if (name) return name.split(' ')[0].slice(0, 40);
  }

  return 'Passageiro';
}

export function isPassengerHistoryRide(ride) {
  return TERMINAL_RIDE_STATUSES.has(String(ride?.status || ''));
}

export function passengerRideTimestampMs(ride) {
  return timestampMs(
    ride?.completedAtMs
      || ride?.cancelledAtMs
      || ride?.updatedAtMs
      || ride?.createdAtMs
      || ride?.completedAt
      || ride?.cancelledAt
      || ride?.updatedAt
      || ride?.createdAt
  );
}

export function sortPassengerRideHistory(rides) {
  return [...(Array.isArray(rides) ? rides : [])]
    .filter(isPassengerHistoryRide)
    .sort((left, right) => passengerRideTimestampMs(right) - passengerRideTimestampMs(left));
}

export function passengerRideStatusLabel(status) {
  return STATUS_LABELS[String(status || '')] || 'Status indisponível';
}

export function passengerRideVehicleLabel(vehicleType) {
  return VEHICLE_LABELS[String(vehicleType || '')] || 'Veículo';
}

export function passengerRideFareCentavos(ride) {
  const values = [
    ride?.finalFareCentavos,
    ride?.paymentAmountCentavos,
    ride?.estimatedFareCentavos,
  ];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.trunc(number);
  }
  return null;
}

export function formatCentavosBRL(value) {
  const centavos = Number(value);
  if (!Number.isFinite(centavos) || centavos < 0) return 'Valor indisponível';
  const reais = Math.trunc(centavos) / 100;
  return `R$ ${reais.toFixed(2).replace('.', ',')}`;
}

export function passengerRidePointLabel(point, fallback) {
  return cleanText(point?.label, 140) || fallback;
}

export function formatPassengerRideDate(ride) {
  const value = passengerRideTimestampMs(ride);
  if (!value) return 'Data indisponível';
  try {
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_error) {
    return new Date(value).toISOString();
  }
}
