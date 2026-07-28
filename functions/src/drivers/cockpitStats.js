'use strict';

// Pure aggregation policy for the compact driver cockpit. The driver receives the
// full ride fare directly through Pix, so "received" means the completed ride fare
// and never fare minus DriveLocal commission.

const COCKPIT_STATS_VERSION = 'driver-cockpit-stats-v1';
const COCKPIT_TIME_ZONE = 'America/Fortaleza';

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function localDateParts(nowMs, timeZone = COCKPIT_TIME_ZONE) {
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

function isoDateKey(parts) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function cockpitPeriodKeys(nowMs, timeZone = COCKPIT_TIME_ZONE) {
  const parts = localDateParts(nowMs, timeZone);
  const dayKey = isoDateKey(parts);
  const localCalendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const mondayOffset = (localCalendarDate.getUTCDay() + 6) % 7;
  localCalendarDate.setUTCDate(localCalendarDate.getUTCDate() - mondayOffset);
  const weekKey = isoDateKey({
    year: localCalendarDate.getUTCFullYear(),
    month: localCalendarDate.getUTCMonth() + 1,
    day: localCalendarDate.getUTCDate(),
  });
  return { dayKey, weekKey, timeZone };
}

function periodAggregate({ priorKey, eventKey, priorCount, priorAmount, eventAmount }) {
  if (!priorKey || eventKey > priorKey) {
    return { key: eventKey, count: 1, amount: eventAmount };
  }
  if (eventKey === priorKey) {
    return {
      key: priorKey,
      count: nonNegativeInteger(priorCount) + 1,
      amount: nonNegativeInteger(priorAmount) + eventAmount,
    };
  }
  // Firestore delivery is at-least-once and can be delayed. An older event must
  // never roll the visible cockpit back to an earlier day/week.
  return {
    key: priorKey,
    count: nonNegativeInteger(priorCount),
    amount: nonNegativeInteger(priorAmount),
  };
}

function nextDriverCockpitStats(previous, completedAtMs, receivedCentavos) {
  const prior = previous && typeof previous === 'object' ? previous : {};
  const keys = cockpitPeriodKeys(completedAtMs);
  const amount = nonNegativeInteger(receivedCentavos);
  const day = periodAggregate({
    priorKey: prior.dayKey,
    eventKey: keys.dayKey,
    priorCount: prior.todayRideCount,
    priorAmount: prior.todayReceivedCentavos,
    eventAmount: amount,
  });
  const week = periodAggregate({
    priorKey: prior.weekKey,
    eventKey: keys.weekKey,
    priorCount: prior.weekRideCount,
    priorAmount: prior.weekReceivedCentavos,
    eventAmount: amount,
  });

  return Object.freeze({
    version: COCKPIT_STATS_VERSION,
    timeZone: COCKPIT_TIME_ZONE,
    dayKey: day.key,
    weekKey: week.key,
    todayRideCount: day.count,
    todayReceivedCentavos: day.amount,
    weekRideCount: week.count,
    weekReceivedCentavos: week.amount,
    lastCompletedAtMs: Math.max(
      nonNegativeInteger(prior.lastCompletedAtMs),
      nonNegativeInteger(completedAtMs)
    ),
  });
}

module.exports = {
  COCKPIT_STATS_VERSION,
  COCKPIT_TIME_ZONE,
  nonNegativeInteger,
  localDateParts,
  cockpitPeriodKeys,
  periodAggregate,
  nextDriverCockpitStats,
};