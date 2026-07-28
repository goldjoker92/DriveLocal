// Pure presentation helpers for the compact driver cockpit. No Firestore access,
// no mock values and no exact per-ride platform commission amounts.

import { MIN_WALLET_BALANCE_CENTAVOS } from '../constants/pricingConfig';
import { resolveCommercialPolicy } from './commercialPolicy';

export const DRIVER_COCKPIT_STATS_VERSION = 'driver-cockpit-stats-v1';
export const DRIVER_PERFORMANCE_STATS_VERSION = 'driver-performance-stats-v1';
export const DRIVER_COCKPIT_TIME_ZONE = 'America/Fortaleza';

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function ratioBps(numerator, denominator) {
  const safeNumerator = nonNegativeInteger(numerator);
  const safeDenominator = nonNegativeInteger(denominator);
  if (safeDenominator <= 0) return null;
  return Math.max(0, Math.min(10000, Math.round((safeNumerator * 10000) / safeDenominator)));
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

function normalizeDisplayName(value) {
  const normalized = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  if (!normalized || normalized.includes('@')) return '';
  const safe = normalized
    .replace(/[^\p{L}\p{M}\p{N}'’\- .]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return /\p{L}/u.test(safe) ? safe : '';
}

function firstNameToken(value) {
  const normalized = normalizeDisplayName(value);
  if (!normalized) return '';
  const token = normalized.split(' ')[0]
    .replace(/^['’\-]+|['’\-]+$/g, '')
    .slice(0, 40);
  return /\p{L}/u.test(token) ? token : '';
}

export function driverCockpitDisplayName(driver) {
  const display = normalizeDisplayName(driver?.displayName);
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

// Wallet readiness is derived from the same commercial policy and real available
// balance used by the backend. `walletStatus` may still exist on legacy records, but
// it never decides whether the cockpit asks the driver to recharge.
function walletStatusPresentation(driver, availableCentavos, nowMs) {
  const commercial = resolveCommercialPolicy(driver || {}, nowMs);
  if (commercial.freePeriodActive) {
    return {
      walletState: 'not_required',
      walletStatusLabel: 'nenhuma recarga necessária',
      walletNeedsTopup: false,
      commissionFree: true,
      commissionFreeUntilMs: commercial.freePeriodUntilMs || null,
    };
  }

  const blocked = !(availableCentavos > MIN_WALLET_BALANCE_CENTAVOS);
  return {
    walletState: blocked ? 'blocked' : 'ready',
    walletStatusLabel: blocked ? 'recarga necessária' : 'disponível para comissões',
    walletNeedsTopup: blocked,
    commissionFree: false,
    commissionFreeUntilMs: null,
  };
}

export function deriveDriverCockpitSummary(driver, nowMs = Date.now()) {
  const stats = driver?.cockpitStats && typeof driver.cockpitStats === 'object'
    ? driver.cockpitStats
    : {};
  const performance = driver?.driverPerformanceStats
    && typeof driver.driverPerformanceStats === 'object'
    ? driver.driverPerformanceStats
    : {};
  const keys = driverCockpitPeriodKeys(nowMs);
  const dayCurrent = stats.dayKey === keys.dayKey;
  const weekCurrent = stats.weekKey === keys.weekKey;
  const available = nonNegativeInteger(
    driver?.walletAvailableCentavos ?? driver?.walletBalanceCentavos ?? driver?.balanceCents
  );
  const held = nonNegativeInteger(driver?.walletHeldCentavos);
  const total = nonNegativeInteger(driver?.walletBalanceCentavos ?? available + held);
  const wallet = walletStatusPresentation(driver, available, nowMs);
  const offersReceivedCount = nonNegativeInteger(performance.offersReceivedCount);
  const offersAcceptedCount = nonNegativeInteger(performance.offersAcceptedCount);
  const terminalRideCount = nonNegativeInteger(performance.terminalRideCount);
  const trackedCompletedRideCount = nonNegativeInteger(performance.completedRideCount);
  const trackedCancelledRideCount = nonNegativeInteger(performance.cancelledRideCount);
  const excludedCancellationCount = nonNegativeInteger(performance.excludedCancellationCount);
  const totalCompletedRideCount = Math.max(
    nonNegativeInteger(driver?.completedRideCount),
    trackedCompletedRideCount
  );

  return Object.freeze({
    statsVersion: stats.version || null,
    performanceStatsVersion: performance.version || null,
    dayKey: keys.dayKey,
    weekKey: keys.weekKey,
    todayRideCount: dayCurrent ? nonNegativeInteger(stats.todayRideCount) : 0,
    todayReceivedCentavos: dayCurrent ? nonNegativeInteger(stats.todayReceivedCentavos) : 0,
    weekRideCount: weekCurrent ? nonNegativeInteger(stats.weekRideCount) : 0,
    weekReceivedCentavos: weekCurrent ? nonNegativeInteger(stats.weekReceivedCentavos) : 0,
    totalCompletedRideCount,
    offersReceivedCount,
    offersAcceptedCount,
    terminalRideCount,
    trackedCompletedRideCount,
    trackedCancelledRideCount,
    excludedCancellationCount,
    acceptanceRateBps: ratioBps(offersAcceptedCount, offersReceivedCount),
    completionRateBps: ratioBps(trackedCompletedRideCount, terminalRideCount),
    performanceTrackingStartedAtMs: nonNegativeInteger(performance.trackingStartedAtMs) || null,
    performanceUpdatedAtMs: nonNegativeInteger(performance.updatedAtMs) || null,
    walletAvailableCentavos: available,
    walletHeldCentavos: held,
    walletBalanceCentavos: total,
    walletState: wallet.walletState,
    walletStatusLabel: wallet.walletStatusLabel,
    walletNeedsTopup: wallet.walletNeedsTopup,
    walletMinimumCentavos: MIN_WALLET_BALANCE_CENTAVOS,
    walletMinimumEligibleCentavos: MIN_WALLET_BALANCE_CENTAVOS + 1,
    commissionFree: wallet.commissionFree,
    commissionFreeUntilMs: wallet.commissionFreeUntilMs,
    statsCurrent: dayCurrent && weekCurrent,
    performanceStatsReady: performance.version === DRIVER_PERFORMANCE_STATS_VERSION,
  });
}
