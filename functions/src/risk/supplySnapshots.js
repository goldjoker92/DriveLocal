// @ts-check
// Hourly aggregate supply snapshot for demand-vs-driver studies. Stores counts only
// (moto/car, online/available/busy); no driver id or coordinate is persisted.

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const rideC = require('../rides/constants');
const riskC = require('./constants');

const REGION = 'southamerica-east1';
const TIME_ZONE = 'America/Fortaleza';
const DRIVER_LIMIT = 1500;

function vehicle(driver) {
  return driver?.vehicleType === 'moto' ? 'moto' : 'car';
}

function buildSupplySnapshot(drivers = [], timestampMs = Date.now()) {
  const result = {
    timestampMs,
    online: { moto: 0, car: 0, total: 0 },
    available: { moto: 0, car: 0, total: 0 },
    busy: { moto: 0, car: 0, total: 0 },
    approved: { moto: 0, car: 0, total: 0 },
  };
  drivers.forEach((driver) => {
    const type = vehicle(driver);
    if (driver?.verificationStatus === 'approved' && driver?.isBlocked !== true) {
      result.approved[type] += 1;
      result.approved.total += 1;
    }
    if (driver?.availabilityStatus !== 'online' || driver?.isBlocked === true) return;
    result.online[type] += 1;
    result.online.total += 1;
    if (driver?.activeRideId) {
      result.busy[type] += 1;
      result.busy.total += 1;
    } else {
      result.available[type] += 1;
      result.available.total += 1;
    }
  });
  return result;
}

function hourSnapshotId(timestampMs) {
  return new Date(Math.floor(timestampMs / 3600000) * 3600000)
    .toISOString()
    .replace(/[-:]/g, '')
    .slice(0, 11);
}

async function recordSupplySnapshot({ db, clock, context }) {
  const nowMs = Number(clock?.now?.() || Date.now());
  const snapshot = await db.collection(rideC.DRIVERS).limit(DRIVER_LIMIT).get();
  const drivers = snapshot.docs.map((document) => document.data() || {});
  const aggregate = buildSupplySnapshot(drivers, nowMs);
  const snapshotId = hourSnapshotId(nowMs);

  await db.collection(riskC.COLLECTIONS.OPERATIONAL_SNAPSHOTS).doc(snapshotId).set({
    ...aggregate,
    serviceAreaId: rideC.DEFAULT_SERVICE_AREA_ID,
    timeZone: TIME_ZONE,
    driverScanCount: snapshot.size,
    truncated: snapshot.size >= DRIVER_LIMIT,
    createdAtMs: nowMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  logInfo(context, 'analytics.supply_snapshot_recorded', {
    operation: 'supply_snapshot',
    result: snapshot.size >= DRIVER_LIMIT ? 'truncated' : 'recorded',
    count: aggregate.online.total,
  });
  return { snapshotId, ...aggregate, truncated: snapshot.size >= DRIVER_LIMIT };
}

const supplySnapshotTask = onSchedule(
  { region: REGION, schedule: 'every 60 minutes', timeZone: TIME_ZONE, retryCount: 1 },
  async () => {
    const context = createLoggerContext({ functionName: 'supplySnapshotTask', actorType: 'system' });
    try {
      return await recordSupplySnapshot({
        db: admin.firestore(),
        clock: { now: () => Date.now() },
        context,
      });
    } catch (error) {
      logWarning(context, 'analytics.supply_snapshot_failed', {
        operation: 'supply_snapshot',
        internalMessage: error?.message,
      });
      throw error;
    }
  }
);

module.exports = {
  DRIVER_LIMIT,
  buildSupplySnapshot,
  hourSnapshotId,
  recordSupplySnapshot,
  supplySnapshotTask,
};
