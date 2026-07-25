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

const PAYMENT_STAGE_STATUSES = new Set([
  'awaiting_payment',
  'payment_marked_sent',
  'disputed',
  'completed',
]);
const ACTIVE_HOLD_STATUSES = new Set([
  'assigned',
  'driver_arrived',
  'in_progress',
  'awaiting_payment',
  'payment_marked_sent',
  'disputed',
]);

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

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
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(epochMs)).map((part) => [part.type, part.value])
  );
  const dayMap = {
    Sun: 'sun',
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
  };
  return {
    dayKey: dayMap[parts.weekday] || 'sun',
    hour: Math.max(0, Math.min(23, Number(parts.hour) || 0)),
  };
}

function vehicleTypeOf(record) {
  return record?.vehicleType === 'moto' ? 'moto' : 'car';
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
    const createdAtMs = num(ride?.createdAtMs);
    const time = localParts(createdAtMs || Date.now());
    const hour = byHour[time.hour];
    const day = byDay[time.dayKey];

    bucket.requests += 1;
    hour.requests += 1;
    day.requests += 1;
    hour[type === 'moto' ? 'motoRequests' : 'carRequests'] += 1;

    if (ride?.acceptedDriverId) bucket.assigned += 1;
    if (
      ride?.startedAtMs
      || status === 'in_progress'
      || PAYMENT_STAGE_STATUSES.has(status)
    ) {
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

    const fare = num(ride?.finalFareCentavos || ride?.estimatedFareCentavos);
    const expected = num(ride?.finalCommissionCentavos ?? ride?.estimatedCommissionCentavos);
    const held = num(ride?.commissionHoldCentavos);
    const captured = num(ride?.commissionCapturedCentavos);
    const released = num(ride?.holdReleasedCentavos);

    // Fare/commission are business results only once the physical ride finished.
    // Search failures and normal cancellations are not counted as lost commission.
    if (PAYMENT_STAGE_STATUSES.has(status)) {
      bucket.fareCentavos += fare;
      bucket.commissionExpectedCentavos += expected;
    }
    if (ACTIVE_HOLD_STATUSES.has(status)) bucket.commissionHeldCentavos += held;
    bucket.commissionCapturedCentavos += captured;
    bucket.commissionReleasedCentavos += released;
    if (status === 'disputed') bucket.commissionDisputedCentavos += held;
    hour.commissionCapturedCentavos += captured;
    day.commissionCapturedCentavos += captured;
  });

  const total = Object.keys(emptyVehicleBucket()).reduce((acc, key) => {
    acc[key] = num(byVehicle.moto[key]) + num(byVehicle.car[key]);
    return acc;
  }, {});

  return {
    byVehicle,
    total,
    byHour,
    byDay: DAY_KEYS.map((key) => byDay[key]),
    peakHours: [...byHour]
      .sort((a, b) => b.requests - a.requests || a.hour - b.hour)
      .slice(0, 5),
    peakRevenueHours: [...byHour]
      .sort((a, b) => b.commissionCapturedCentavos - a.commissionCapturedCentavos || a.hour - b.hour)
      .slice(0, 5),
    peakUnservedHours: [...byHour]
      .sort((a, b) => b.noDriverAvailable - a.noDriverAvailable || a.hour - b.hour)
      .slice(0, 5),
    peakDays: DAY_KEYS.map((key) => byDay[key])
      .sort((a, b) => b.requests - a.requests),
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
  const sevenDays = 7 * 86400000;

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

    const available = num(driver?.walletAvailableCentavos);
    const held = num(driver?.walletHeldCentavos);
    result.walletAvailableCentavos += available;
    result.walletHeldCentavos += held;
    if (available <= 300 && driver?.verificationStatus === 'approved') {
      result.lowWallet[type] += 1;
      result.lowWallet.total += 1;
    }
  });

  result.theoreticalMrrCentavos.moto = result.activeSubscriptions.moto
    * driverC.MOTO_SUBSCRIPTION_CENTAVOS;
  result.theoreticalMrrCentavos.car = result.activeSubscriptions.car
    * driverC.CAR_SUBSCRIPTION_CENTAVOS;
  result.theoreticalMrrCentavos.total = result.theoreticalMrrCentavos.moto
    + result.theoreticalMrrCentavos.car;
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
    const amount = num(payment?.amountCentavos);
    if (status === 'paid' && payment?.purpose === 'driver_subscription') {
      result.subscriptionRevenueCentavos += amount;
      result.paidSubscriptions += 1;
    } else if (status === 'paid' && payment?.purpose === 'wallet_topup') {
      result.walletTopupsCentavos += amount;
      result.paidTopups += 1;
    } else if (status === 'pending') result.pendingPayments += 1;
    else if (['failed', 'expired', 'cancelled'].includes(status)) result.failedPayments += 1;
  });
  return result;
}

function aggregateAlerts(alerts = []) {
  const result = { open: 0, critical: 0, high: 0, amountAtRiskCentavos: 0, byReason: {} };
  alerts.forEach((alert) => {
    if (alert?.status !== 'resolved') result.open += 1;
    if (alert?.status !== 'resolved' && alert?.severity === 'critical') result.critical += 1;
    if (alert?.status !== 'resolved' && alert?.severity === 'high') result.high += 1;
    if (alert?.status !== 'resolved') result.amountAtRiskCentavos += num(alert?.amountAtRiskCentavos);
    const reason = String(alert?.reasonCode || 'UNKNOWN');
    result.byReason[reason] = num(result.byReason[reason]) + 1;
  });
  return result;
}

function aggregateSupplySnapshots(snapshots = []) {
  const byHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    sampleCount: 0,
    onlineTotal: 0,
    availableTotal: 0,
    onlineMoto: 0,
    availableMoto: 0,
    onlineCar: 0,
    availableCar: 0,
  }));
  let latest = null;

  snapshots.forEach((snapshot) => {
    const timestampMs = num(snapshot?.timestampMs || snapshot?.createdAtMs);
    if (!timestampMs) return;
    const hour = byHour[localParts(timestampMs).hour];
    hour.sampleCount += 1;
    hour.onlineTotal += num(snapshot?.online?.total);
    hour.availableTotal += num(snapshot?.available?.total);
    hour.onlineMoto += num(snapshot?.online?.moto);
    hour.availableMoto += num(snapshot?.available?.moto);
    hour.onlineCar += num(snapshot?.online?.car);
    hour.availableCar += num(snapshot?.available?.car);
    if (!latest || timestampMs > latest.timestampMs) latest = { timestampMs, ...snapshot };
  });

  const averagesByHour = byHour.map((row) => {
    const divisor = row.sampleCount || 1;
    return {
      hour: row.hour,
      sampleCount: row.sampleCount,
      averageOnline: row.onlineTotal / divisor,
      averageAvailable: row.availableTotal / divisor,
      averageOnlineMoto: row.onlineMoto / divisor,
      averageAvailableMoto: row.availableMoto / divisor,
      averageOnlineCar: row.onlineCar / divisor,
      averageAvailableCar: row.availableCar / divisor,
    };
  });
  return { latest, averagesByHour };
}

function buildDemandSupply(ridesByHour = [], supplyByHour = []) {
  return ridesByHour.map((rideHour) => {
    const supply = supplyByHour.find((row) => row.hour === rideHour.hour) || {};
    const available = num(supply.averageAvailable);
    return {
      hour: rideHour.hour,
      requests: num(rideHour.requests),
      noDriverAvailable: num(rideHour.noDriverAvailable),
      averageOnlineDrivers: num(supply.averageOnline),
      averageAvailableDrivers: available,
      requestsPerAvailableDriver: available > 0 ? num(rideHour.requests) / available : null,
    };
  });
}

function buildAdminAnalytics({
  rides = [],
  drivers = [],
  payments = [],
  alerts = [],
  supplySnapshots = [],
  nowMs = Date.now(),
  rangeDays = 30,
}) {
  const rideAnalytics = aggregateRides(rides);
  const driverAnalytics = aggregateDrivers(drivers, nowMs);
  const paymentAnalytics = aggregatePayments(payments);
  const alertAnalytics = aggregateAlerts(alerts);
  const supply = aggregateSupplySnapshots(supplySnapshots);
  const commissionRevenueCentavos = rideAnalytics.total.commissionCapturedCentavos;
  const confirmedRevenueCentavos = commissionRevenueCentavos
    + paymentAnalytics.subscriptionRevenueCentavos;
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
    supply: {
      ...supply,
      demandVsSupply: buildDemandSupply(rideAnalytics.byHour, supply.averagesByHour),
    },
  };
}

module.exports = {
  TIME_ZONE,
  DAY_KEYS,
  DAY_LABELS_PT_BR,
  PAYMENT_STAGE_STATUSES,
  ACTIVE_HOLD_STATUSES,
  localParts,
  aggregateRides,
  aggregateDrivers,
  aggregatePayments,
  aggregateAlerts,
  aggregateSupplySnapshots,
  buildDemandSupply,
  buildAdminAnalytics,
};
