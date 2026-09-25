// @ts-check
// Bounded operational antifraud scan for launch. It detects explainable patterns
// (repeated cancellations/disputes, implausibly short rides and repeated pairs)
// and opens review cases. It never blocks or bans automatically.

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const rideC = require('../rides/constants');
const riskC = require('./constants');
const { bestEffortRiskSignal, stableId } = require('./riskEngine');

const REGION = 'southamerica-east1';
const TIME_ZONE = 'America/Fortaleza';
const WINDOW_DAYS = 14;
const RIDE_SCAN_LIMIT = 5000;
const CANCELLATION_THRESHOLD = 3;
const DISPUTE_THRESHOLD = 2;
const PAIR_THRESHOLD = 8;

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, Number(map.get(key) || 0) + amount);
}

function pushMap(map, key, value) {
  if (!key) return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

function dailyBucket(nowMs) {
  return Math.floor(Number(nowMs || Date.now()) / 86400000);
}

function signal({ actorType, actorId, reasonCode, severity, sourceType, sourceId, eventKey, metadata }) {
  return {
    actorType,
    actorId,
    reasonCode,
    severity,
    recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
    sourceType,
    sourceId,
    eventKey,
    metadata,
  };
}

function detectOperationalPatterns(rides = [], nowMs = Date.now()) {
  const cancellations = new Map();
  const disputesAgainstPassenger = new Map();
  const disputesAgainstDriver = new Map();
  const pairRides = new Map();
  const signals = [];
  const bucket = dailyBucket(nowMs);

  rides.forEach((ride) => {
    const rideId = String(ride.rideId || ride.id || 'unknown');
    const passengerId = ride.passengerId;
    const driverId = ride.acceptedDriverId;
    const status = String(ride.status || 'unknown');

    if (status === rideC.RIDE_STATUS.CANCELLED) {
      const actorType = ride.cancelledBy === 'driver'
        ? riskC.ACTOR_TYPE.DRIVER
        : riskC.ACTOR_TYPE.PASSENGER;
      const actorId = actorType === riskC.ACTOR_TYPE.DRIVER ? driverId : passengerId;
      if (actorId) increment(cancellations, `${actorType}|${actorId}`);
    }

    const resolution = ride.disputeResolution?.outcome;
    if (resolution === 'confirm_driver_payment' && passengerId) {
      // Admin confirmed that the driver was paid/commission is due after a dispute.
      // Repetition may indicate false or misleading passenger payment declarations.
      increment(disputesAgainstPassenger, passengerId);
    }
    if (resolution === 'release_driver_hold' && driverId) {
      // Admin concluded no commission was due. Repetition may indicate invalid
      // non-receipt claims or recurring operational problems around this driver.
      increment(disputesAgainstDriver, driverId);
    }

    if (status === rideC.RIDE_STATUS.COMPLETED && passengerId && driverId) {
      const pairKey = `${driverId}|${passengerId}`;
      pushMap(pairRides, pairKey, rideId);

      const startedAtMs = Number(ride.startedAtMs || 0);
      const completedAtMs = Number(ride.completedAtMs || 0);
      const routeDurationMs = Number(ride.routeDurationSeconds || 0) * 1000;
      const routeDistanceMeters = Number(ride.routeDistanceMeters || 0);
      const actualDurationMs = completedAtMs - startedAtMs;
      const minimumPlausibleMs = Math.max(60_000, routeDurationMs * 0.2);
      if (
        startedAtMs > 0
        && completedAtMs > startedAtMs
        && routeDistanceMeters >= 1500
        && routeDurationMs >= 180_000
        && actualDurationMs < minimumPlausibleMs
      ) {
        const metadata = {
          vehicleType: ride.vehicleType,
          count: 1,
          windowDays: WINDOW_DAYS,
          result: 'implausibly_short',
        };
        signals.push(signal({
          actorType: riskC.ACTOR_TYPE.DRIVER,
          actorId: driverId,
          reasonCode: riskC.REASON.SUSPICIOUS_RIDE_DURATION,
          severity: riskC.SEVERITY.HIGH,
          sourceType: 'ride',
          sourceId: rideId,
          eventKey: `short_ride_${bucket}`,
          metadata,
        }));
        signals.push(signal({
          actorType: riskC.ACTOR_TYPE.PASSENGER,
          actorId: passengerId,
          reasonCode: riskC.REASON.SUSPICIOUS_RIDE_DURATION,
          severity: riskC.SEVERITY.HIGH,
          sourceType: 'ride',
          sourceId: rideId,
          eventKey: `short_ride_${bucket}`,
          metadata,
        }));
      }
    }
  });

  cancellations.forEach((count, key) => {
    if (count < CANCELLATION_THRESHOLD) return;
    const [actorType, actorId] = key.split('|');
    signals.push(signal({
      actorType,
      actorId,
      reasonCode: riskC.REASON.REPEATED_CANCELLATIONS,
      severity: count >= 6 ? riskC.SEVERITY.HIGH : riskC.SEVERITY.MEDIUM,
      sourceType: 'risk_window',
      sourceId: `cancellations_${bucket}`,
      eventKey: `cancellations_${bucket}`,
      metadata: { count, windowDays: WINDOW_DAYS },
    }));
  });

  disputesAgainstPassenger.forEach((count, passengerId) => {
    if (count < DISPUTE_THRESHOLD) return;
    signals.push(signal({
      actorType: riskC.ACTOR_TYPE.PASSENGER,
      actorId: passengerId,
      reasonCode: riskC.REASON.PASSENGER_FALSE_PAYMENT_PATTERN,
      severity: riskC.SEVERITY.HIGH,
      sourceType: 'risk_window',
      sourceId: `passenger_payment_${bucket}`,
      eventKey: `passenger_payment_${bucket}`,
      metadata: { count, windowDays: WINDOW_DAYS },
    }));
  });

  disputesAgainstDriver.forEach((count, driverId) => {
    if (count < DISPUTE_THRESHOLD) return;
    signals.push(signal({
      actorType: riskC.ACTOR_TYPE.DRIVER,
      actorId: driverId,
      reasonCode: riskC.REASON.DRIVER_NON_RECEIPT_PATTERN,
      severity: riskC.SEVERITY.HIGH,
      sourceType: 'risk_window',
      sourceId: `driver_payment_${bucket}`,
      eventKey: `driver_payment_${bucket}`,
      metadata: { count, windowDays: WINDOW_DAYS },
    }));
  });

  pairRides.forEach((rideIds, pairKey) => {
    if (rideIds.length < PAIR_THRESHOLD) return;
    const [driverId, passengerId] = pairKey.split('|');
    const pairSource = `pair_${stableId([driverId, passengerId, String(bucket)])}`;
    const metadata = { count: rideIds.length, windowDays: WINDOW_DAYS };
    signals.push(signal({
      actorType: riskC.ACTOR_TYPE.DRIVER,
      actorId: driverId,
      reasonCode: riskC.REASON.REPEATED_DRIVER_PASSENGER_PAIR,
      severity: riskC.SEVERITY.MEDIUM,
      sourceType: 'driver_passenger_pair',
      sourceId: pairSource,
      eventKey: `pair_${bucket}`,
      metadata,
    }));
    signals.push(signal({
      actorType: riskC.ACTOR_TYPE.PASSENGER,
      actorId: passengerId,
      reasonCode: riskC.REASON.REPEATED_DRIVER_PASSENGER_PAIR,
      severity: riskC.SEVERITY.MEDIUM,
      sourceType: 'driver_passenger_pair',
      sourceId: pairSource,
      eventKey: `pair_${bucket}`,
      metadata,
    }));
  });

  return signals;
}

async function runOperationalRiskScan({ db, clock, context }) {
  const nowMs = Number(clock?.now?.() || Date.now());
  const startMs = nowMs - WINDOW_DAYS * 86400000;
  const snapshot = await db.collection(rideC.RIDE_REQUESTS)
    .where('createdAtMs', '>=', startMs)
    .limit(RIDE_SCAN_LIMIT)
    .get();
  const rides = snapshot.docs.map((document) => ({ id: document.id, ...(document.data() || {}) }));
  const signals = detectOperationalPatterns(rides, nowMs);

  for (const detected of signals) {
    await bestEffortRiskSignal({ db, clock, context, ...detected });
  }

  await db.collection(riskC.COLLECTIONS.SYSTEM_HEALTH).doc('operationalRisk').set({
    status: signals.length > 0 ? 'attention' : 'ok',
    detectedCount: signals.length,
    scannedRideCount: snapshot.size,
    truncated: snapshot.size >= RIDE_SCAN_LIMIT,
    windowDays: WINDOW_DAYS,
    lastCheckedAtMs: nowMs,
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  logInfo(context, 'risk.operational_scan.completed', {
    operation: 'operational_risk_scan',
    result: signals.length > 0 ? 'signals_detected' : 'ok',
    count: signals.length,
    windowDays: WINDOW_DAYS,
  });
  return { scannedRideCount: snapshot.size, signalCount: signals.length };
}

const operationalRiskScanTask = onSchedule(
  { region: REGION, schedule: 'every 6 hours', timeZone: TIME_ZONE, retryCount: 1 },
  async () => {
    const context = createLoggerContext({ functionName: 'operationalRiskScanTask', actorType: 'system' });
    try {
      return await runOperationalRiskScan({
        db: admin.firestore(),
        clock: { now: () => Date.now() },
        context,
      });
    } catch (error) {
      logWarning(context, 'risk.operational_scan.failed', {
        operation: 'operational_risk_scan',
        internalMessage: error?.message,
      });
      throw error;
    }
  }
);

module.exports = {
  WINDOW_DAYS,
  RIDE_SCAN_LIMIT,
  CANCELLATION_THRESHOLD,
  DISPUTE_THRESHOLD,
  PAIR_THRESHOLD,
  dailyBucket,
  detectOperationalPatterns,
  runOperationalRiskScan,
  operationalRiskScanTask,
};
