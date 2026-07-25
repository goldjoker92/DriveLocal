// @ts-check
// Pure business analytics for the admin dashboard. Inputs are bounded snapshots;
// outputs contain aggregate numbers only — never passenger/driver PII or precise
// coordinates. All money remains integer centavos.

const driverC = require('../drivers/constants');
const { toMillis } = require('../drivers/eligibility');

const TIME_ZONE = 'America/Fortaleza';
const DAY_KEYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const DAY_LABELS_PT_BR = Object.freeze({
  sun: 'Domingo',
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
});

function emptyVehicleBucket() {
  return {
    requests: 0,
    assigned: 0,
    started: 0,
    completed: 0,
    cancelled: 0,
    disputed: 0,
    noDriverAvailable: 0,
    fareCentavos: 0,
    commissionExpectedCentavos: 0,
    commissionHeldCentavos: 0,
    commissionCapturedCentavos: 0,
    commissionReleasedCentavos: 0,
    commissionDisputedCentavos: 0,
  };
}

function localParts(epochMs) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const dayMap = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };
  return {
    dayKey: dayMap[parts.weekday] || 'sun',
    hour: Math.max(0, Math.min(23, Number(parts.hour) || 0)),
  };
}

function vehicleTypeOf(record) {
  return record?.vehicleType === 'moto' ? 'moto' : 'car';
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function aggregateRides(rides = []) {
  const byVehicle = { moto: emptyVehicleBucket(), car: emptyVehicleBucket() };
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    requests: 0,
    completed: 0,
    noDriverAvailable: 0,
    cancellations: 0,
    commissionCapturedCentavos: 0,
    motoRequests: 0,
    carRequests: 0,
  }));
  const byDay = Object.fromEntries(DAY_KEYS.map((key) => [key, {
    dayKey: key,
    label: DAY_LABELS_PT_BR[key],
    requests: 0,
    completed: 0,
    noDriverAvailable: 0,
    cancellations: 0,
    commissionCapturedCentavos: 0,
  }]));

  rides.forEach((ride) => {
    const type = vehicleTypeOf(ride);
    const bucket = byVehicle[type];
    const status = String(ride?.status || 'unknown');
    const createdAtMs = number(ride?.createdAtMs);
    const time = localParts(createdAtMs || Date.now());
    const hour = byHour[time.hour];
    const day = byDay[time.dayKey];

    bucket.requests += 1;
    hour.requests += 1;
    day.requests += 1;
    hour[type === 'moto' ? 'motoRequests' : 'carRequests'] += 1;

    if (ride?.acceptedDriverId) bucket.assigned += 1;
    if (ride?.startedAtMs || status === 'in_progress' || status === 'awaiting_payment' || status === 'payment_marked_sent' || status === 'completed' || status === 'disputed') {
      bucket.started += 1;
    }
    if (status === 'completed') {
      bucket.completed += 1;
      hour.completed += 1;
      day.completed += 1;
    }
    if (status === 'cancelled') {
      bucket.cancelled += 1;
      hour.cancellations += 1;
      day.cancellations += 1;
    }
    if (status === 'disputed') bucket.disputed += 1;
    if (status === 'no_driver_available' || status === 'dispatch_failed') {
      bucket.noDriverAvailable += 1;
      hour.noDriverAvailable += 1;
      day.noDriverAvailable += 1;
    }

    const fare = number(ride?.finalFareCentavos || ride?.estimatedFareCentavos);
    const expected = number(ride?.finalCommissionCentavos ?? ride?.estimatedCommissionCentavos);
    const held = number(ride?.commissionHoldCentavos);
    const captured = number(ride?.commissionCapturedCentavos);
    const released = number(ride?.holdReleasedCentavos);

    bucket.fareCentavos += fare;
    bucket.commissionExpectedCentavos += expected;
    bucket.commissionHeldCentavos += status === 'completed' || status === 'cancelled' ? 0 : held;
    bucket.commissionCapturedCentavos += captured;
    bucket.commissionReleasedCentavos += released;
    if (status === 'disputed') bucket.commissionDisputedCentavos += held;
    hour.commissionCapturedCentavos += captured;
    day.commissionCapturedCentavos += captured;
  });

  const total = Object.keys(emptyVehicleBucket()).reduce((acc, key) => {
    acc[key] = number(byVehicle.moto[key]) + number(byVehicle.car[key]);
    return acc;
  }, {});

  const peakHours = [...byHour]
    .sort((a, b) => b.requests - a.requests || a.hour - b.hour)
    .slice(0, 5);
  const peakRevenueHours = [...byHour]
    .sort((a, b) => b.commissionCapturedCentavos - a.commissionCapturedCentavos || a.hour - b.hour)
    .slice(0, 5);
  const peakUnservedHours = [...byHour]
    .sort((a, b) => b.noDriverAvailable - a.noDriverAvailable || a.hour - b.hour)
    .slice(0, 5);
  const days = DAY_KEYS.map((key) => byDay[key]);
  const peakDays = [...days].sort((a, b) => b.requests - a.requests).slice(0, 7);

  return {
    byVehicle,
    total,
    byHour,
    byDay: days,
    peakHours,
    peakRevenueHours,
    peakUnservedHours,
    peakDays,
  };
}

function aggregateDrivers(drivers = [], nowMs = Date.now()) {
  const result = {
    total: 0,
    approved: 0,
    pendingReview: 0,
    suspended: 0,
    online: 0,
    activeSubscriptions: { moto: 0, car: 0, total: 0 },
    freeSubscriptions: { moto: 0, car: 0, total: 0 },
    expiringWithin7Days: { moto: 0, car: 0, total: 0 },
    expiredSubscriptions: { moto: 0, car: 0, total: 0 },
    lowWallet: { moto: 0, car: 0, total: 0 },
    walletAvailableCentavos: 0,
    walletHeldCentavos: 0,
    theoreticalMrrCentavos: { moto: 0, car: 0, total: 0 },
  };
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  drivers.forEach((driver) => {
    const type = vehicleTypeOf(driver);
    result.total += 1;
    if (driver?.verificationStatus === 'approved') result.approved += 1;
    if (driver?.verificationStatus === 'pending_review') result.pendingReview += 1;
    if (driver?.verificationStatus === 'suspended' || driver?.isBlocked === true) result.suspended += 1;
    if (driver?.availabilityStatus === 'online') result.online += 1;

    const expiry = toMillis(driver?.subscriptionExpiresAt);
    const freeUntil = toMillis(driver?.subscriptionFreeUntil || driver?.founderFreeUntil);
    const activePaid = driver?.subscriptionActive === true && expiry > nowMs;
    const activeFree = freeUntil > nowMs;

    if (activePaid) {
      result.activeSubscriptions[type] += 1;
      result.activeSubscriptions.total += 1;
    }
    if (activeFree) {
      result.freeSubscriptions[type] += 1;
      result.freeSubscriptions.total += 1;
    }
    if (activePaid && expiry <= nowMs + sevenDays) {
      result.expiringWithin7Days[type] += 1;
      result.expiringWithin7Days.total += 1;
    }
    if (driver?.subscriptionActive === true && expiry > 0 && expiry <= nowMs) {
      result.expiredSubscriptions[type] += 1;
      result.expiredSubscriptions.total += 1;
    }

    const available = number(driver?.walletAvailableCentavos);
    const held = number(driver?.walletHeldCentavos);
    result.walletAvailableCentavos += available;
    result.walletHeldCentavos += held;
    if (available <= 300 && driver?.verificationStatus === 'approved') {
      result.lowWallet[type] += 1;
      result.lowWallet.total += 1;
    }
  });

  result.theoreticalMrrCentavos.moto = result.activeSubscriptions.moto * driverC.MOTO_SUBSCRIPTION_CENTAVOS;
  result.theoreticalMrrCentavos.car = result.activeSubscriptions.car * driverC.CAR_SUBSCRIPTION_CENTAVOS;
  result.theoreticalMrrCentavos.total = result.theoreticalMrrCentavos.moto + result.theoreticalMrrCentavos.car;
  return result;
}

function aggregatePayments(payments = []) {
  const result = {
    subscriptionRevenueCentavos: 0,
    walletTopupsCentavos: 0,
    paidSubscriptions: 0,
    paidTopups: 0,
    pendingPayments: 0,
    failedPayments: 0,
  };
  payments.forEach((payment) => {
    const status = payment?.status;
    const amount = number(payment?.amountCentavos);
    if (status === 'paid' && payment?.purpose === 'driver_subscription') {
      result.subscriptionRevenueCentavos += amount;
      result.paidSubscriptions += 1;
    } else if (status === 'paid' && payment?.purpose === 'wallet_topup') {
      result.walletTopupsCentavos += amount;
      result.paidTopups += 1;
    } else if (status === 'pending') result.pendingPayments += 1;
    else if (status === 'failed' || status === 'expired' || status === 'cancelled') result.failedPayments += 1;
  });
  return result;
}

function aggregateAlerts(alerts = []) {
  const result = { open: 0, critical: 0, high: 0, amountAtRiskCentavos: 0, byReason: {} };
  alerts.forEach((alert) => {
    if (alert?.status !== 'resolved') result.open += 1;
    if (alert?.severity === 'critical') result.critical += 1;
    if (alert?.severity === 'high') result.high += 1;
    result.amountAtRiskCentavos += number(alert?.amountAtRiskCentavos);
    const reason = String(alert?.reasonCode || 'UNKNOWN');
    result.byReason[reason] = number(result.byReason[reason]) + 1;
  });
  return result;
}

function buildAdminAnalytics({ rides = [], drivers = [], payments = [], alerts = [], nowMs = Date.now(), rangeDays = 30 }) {
  const rideAnalytics = aggregateRides(rides);
  const driverAnalytics = aggregateDrivers(drivers, nowMs);
  const paymentAnalytics = aggregatePayments(payments);
  const alertAnalytics = aggregateAlerts(alerts);
  const commissionRevenueCentavos = rideAnalytics.total.commissionCapturedCentavos;
  const confirmedRevenueCentavos = commissionRevenueCentavos + paymentAnalytics.subscriptionRevenueCentavos;
  const expectedCommissionCentavos = rideAnalytics.total.commissionExpectedCentavos;
  const captureRate = expectedCommissionCentavos > 0
    ? commissionRevenueCentavos / expectedCommissionCentavos
    : 1;

  return {
    generatedAtMs: nowMs,
    timeZone: TIME_ZONE,
    rangeDays,
    revenue: {
      confirmedRevenueCentavos,
      commissionRevenueCentavos,
      subscriptionRevenueCentavos: paymentAnalytics.subscriptionRevenueCentavos,
      commissionExpectedCentavos: expectedCommissionCentavos,
      commissionHeldCentavos: rideAnalytics.total.commissionHeldCentavos,
      commissionDisputedCentavos: rideAnalytics.total.commissionDisputedCentavos,
      commissionReleasedCentavos: rideAnalytics.total.commissionReleasedCentavos,
      amountAtRiskCentavos: alertAnalytics.amountAtRiskCentavos,
      captureRate,
    },
    rides: rideAnalytics,
    drivers: driverAnalytics,
    payments: paymentAnalytics,
    alerts: alertAnalytics,
  };
}

module.exports = {
  TIME_ZONE,
  DAY_KEYS,
  DAY_LABELS_PT_BR,
  localParts,
  aggregateRides,
  aggregateDrivers,
  aggregatePayments,
  aggregateAlerts,
  buildAdminAnalytics,
};
