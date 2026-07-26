// Pure presentation helpers for the compact driver cockpit. No Firestore access,
// no mock values and no exact per-ride platform commission amounts.

export const DRIVER_COCKPIT_STATS_VERSION = 'driver-cockpit-stats-v1';
export const DRIVER_COCKPIT_TIME_ZONE = 'America/Fortaleza';

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function localDateParts(nowMs, timeZone = DRIVER_COCKPIT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Number(nowMs)));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function dateKey(parts) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function driverCockpitPeriodKeys(nowMs = Date.now()) {
  const parts = localDateParts(nowMs);
  const dayKey = dateKey(parts);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const mondayOffset = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - mondayOffset);
  return {
    dayKey,
    weekKey: dateKey({
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
    }),
  };
}

function firstNameToken(value) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  if (!normalized || normalized.includes('@')) return '';
  const token = normalized.split(' ')[0]
    .replace(/[^\p{L}\p{M}'’-]/gu, '')
    .replace(/^['’\-]+|['’\-]+$/g, '')
    .slice(0, 40);
  return /\p{L}/u.test(token) ? token : '';
}

export function driverCockpitDisplayName(driver) {
  const display = firstNameToken(driver?.displayName);
  if (display) return display;
  const fromFullName = firstNameToken(driver?.fullName);
  return fromFullName || 'Motorista';
}

export function driverCockpitVehicle(driver) {
  const moto = driver?.vehicleType === 'moto';
  const typeLabel = moto ? 'Moto' : 'Carro';
  const emoji = moto ? '🏍' : '🚗';
  const brand = typeof driver?.vehicleBrand === 'string'
    ? driver.vehicleBrand.trim()
    : typeof driver?.vehicleMake === 'string'
      ? driver.vehicleMake.trim()
      : '';
  const model = typeof driver?.vehicleModel === 'string' ? driver.vehicleModel.trim() : '';
  const color = typeof driver?.vehicleColor === 'string' ? driver.vehicleColor.trim() : '';
  const plateSource = driver?.vehiclePlate || driver?.plate;
  const plate = typeof plateSource === 'string' ? plateSource.trim().toUpperCase().slice(0, 12) : '';
  return {
    typeLabel,
    emoji,
    primary: [brand, model].filter(Boolean).join(' ') || typeLabel,
    secondary: [color, plate].filter(Boolean).join(' • '),
  };
}

export function deriveDriverCockpitSummary(driver, nowMs = Date.now()) {
  const stats = driver?.cockpitStats && typeof driver.cockpitStats === 'object'
    ? driver.cockpitStats
    : {};
  const keys = driverCockpitPeriodKeys(nowMs);
  const dayCurrent = stats.dayKey === keys.dayKey;
  const weekCurrent = stats.weekKey === keys.weekKey;
  const available = nonNegativeInteger(
    driver?.walletAvailableCentavos ?? driver?.walletBalanceCentavos ?? driver?.balanceCents
  );
  const held = nonNegativeInteger(driver?.walletHeldCentavos);
  const total = nonNegativeInteger(driver?.walletBalanceCentavos ?? available + held);

  return Object.freeze({
    statsVersion: stats.version || null,
    dayKey: keys.dayKey,
    weekKey: keys.weekKey,
    todayRideCount: dayCurrent ? nonNegativeInteger(stats.todayRideCount) : 0,
    todayReceivedCentavos: dayCurrent ? nonNegativeInteger(stats.todayReceivedCentavos) : 0,
    weekRideCount: weekCurrent ? nonNegativeInteger(stats.weekRideCount) : 0,
    weekReceivedCentavos: weekCurrent ? nonNegativeInteger(stats.weekReceivedCentavos) : 0,
    totalCompletedRideCount: nonNegativeInteger(driver?.completedRideCount),
    walletAvailableCentavos: available,
    walletHeldCentavos: held,
    walletBalanceCentavos: total,
    statsCurrent: dayCurrent && weekCurrent,
  });
}