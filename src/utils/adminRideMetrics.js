// Pure presentation adapter for admin ride metrics.
//
// The secure callable already aggregates every ride request created in the
// selected rolling window. Keeping normalization here prevents a missing or
// malformed field from showing NaN in the admin UI.

export const ADMIN_RIDE_METRIC_PERIODS = Object.freeze([
  { days: 1, label: '24 h' },
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
]);

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function positivePeak(rows, valueKey) {
  return [...(rows || [])]
    .filter((row) => nonNegativeNumber(row?.[valueKey]) > 0)
    .sort((a, b) => nonNegativeNumber(b?.[valueKey]) - nonNegativeNumber(a?.[valueKey]))[0]
    || null;
}

function peakDemandPressure(analytics) {
  const sampledHours = new Set(
    (analytics?.supply?.averagesByHour || [])
      .filter((row) => nonNegativeNumber(row?.sampleCount) > 0)
      .map((row) => Number(row.hour))
  );
  const candidates = (analytics?.supply?.demandVsSupply || [])
    .filter((row) => (
      sampledHours.has(Number(row?.hour))
      && nonNegativeNumber(row?.requests) > 0
    ));

  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aNoSupply = nonNegativeNumber(a?.averageAvailableDrivers) === 0;
    const bNoSupply = nonNegativeNumber(b?.averageAvailableDrivers) === 0;
    if (aNoSupply !== bNoSupply) return aNoSupply ? -1 : 1;
    return nonNegativeNumber(b?.requestsPerAvailableDriver)
      - nonNegativeNumber(a?.requestsPerAvailableDriver);
  })[0];
}

export function deriveAdminRideMetrics(analytics) {
  const total = analytics?.rides?.total || {};
  const rides = analytics?.rides || {};
  const latestSupply = analytics?.supply?.latest || {};
  const moto = rides.byVehicle?.moto || {};
  const car = rides.byVehicle?.car || {};
  const requests = nonNegativeNumber(total.requests);
  const assigned = nonNegativeNumber(total.assigned);
  const started = nonNegativeNumber(total.started);
  const completed = nonNegativeNumber(total.completed);
  const noDriverAvailable = nonNegativeNumber(total.noDriverAvailable);
  const cancelled = nonNegativeNumber(total.cancelled);
  const commissionCapturedCentavos = nonNegativeNumber(total.commissionCapturedCentavos);
  const commissionExpectedCentavos = nonNegativeNumber(total.commissionExpectedCentavos);
  const peakDemand = positivePeak(rides.peakHours, 'requests');
  const peakUnserved = positivePeak(rides.peakUnservedHours, 'noDriverAvailable');
  const peakDay = positivePeak(rides.peakDays, 'requests');
  const pressure = peakDemandPressure(analytics);
  const motoRequests = nonNegativeNumber(moto.requests);
  const carRequests = nonNegativeNumber(car.requests);

  return {
    requests,
    assigned,
    started,
    completed,
    noDriverAvailable,
    cancelled,
    assignmentRate: ratio(assigned, requests),
    startRate: ratio(started, requests),
    completionRate: ratio(completed, requests),
    unservedRate: ratio(noDriverAvailable, requests),
    cancellationRate: ratio(cancelled, requests),
    commissionCapturedCentavos,
    commissionExpectedCentavos,
    // During a zero-commission promotion there is nothing to capture. Keep this
    // distinct from a real 0% capture rate so the admin UI does not report a
    // payment failure that never happened.
    commissionCaptureRate: commissionExpectedCentavos > 0
      ? ratio(commissionCapturedCentavos, commissionExpectedCentavos)
      : null,
    availableDrivers: nonNegativeNumber(latestSupply.available?.total),
    onlineDrivers: nonNegativeNumber(latestSupply.online?.total ?? analytics?.drivers?.online),
    peakDemandHour: peakDemand ? nonNegativeNumber(peakDemand.hour) : null,
    peakDemandRequests: peakDemand ? nonNegativeNumber(peakDemand.requests) : 0,
    peakUnservedHour: peakUnserved ? nonNegativeNumber(peakUnserved.hour) : null,
    peakUnservedRequests: peakUnserved
      ? nonNegativeNumber(peakUnserved.noDriverAvailable)
      : 0,
    peakDayLabel: peakDay?.label || null,
    peakDayRequests: peakDay ? nonNegativeNumber(peakDay.requests) : 0,
    peakPressureHour: pressure ? nonNegativeNumber(pressure.hour) : null,
    peakPressureRequests: pressure ? nonNegativeNumber(pressure.requests) : 0,
    peakPressureRequestsPerDriver: pressure?.requestsPerAvailableDriver == null
      ? null
      : nonNegativeNumber(pressure.requestsPerAvailableDriver),
    peakPressureHasNoAvailableDriver: Boolean(
      pressure && nonNegativeNumber(pressure.averageAvailableDrivers) === 0
    ),
    motoRequests,
    carRequests,
    motoCompletionRate: ratio(nonNegativeNumber(moto.completed), motoRequests),
    carCompletionRate: ratio(nonNegativeNumber(car.completed), carRequests),
    ridesTruncated: analytics?.truncated?.rides === true,
  };
}

export function formatAdminRideRate(value) {
  return `${(nonNegativeNumber(value) * 100).toFixed(1).replace('.', ',')}%`;
}

export function formatAdminRideHour(hour) {
  if (hour == null || !Number.isFinite(Number(hour))) return '—';
  const normalized = Math.max(0, Math.min(23, Math.floor(Number(hour))));
  const next = (normalized + 1) % 24;
  return `${String(normalized).padStart(2, '0')}h–${String(next).padStart(2, '0')}h`;
}

export function formatAdminRideDecimal(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(1).replace('.', ',');
}
