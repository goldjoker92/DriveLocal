// @ts-check
// Hourly aggregate supply snapshot for demand-vs-driver studies. Stores counts only
// (moto/car, online/available/busy); no driver id or coordinate is persisted.

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const { evaluateRideEligibility } = require('../drivers/eligibility');
const {
  driverLocation,
  locationAgeMs,
  hasFreshAvailabilitySession,
  ONLINE_STALE_FALLBACK_MAX_AGE_MS,
} = require('../rides/candidates');
const rideC = require('../rides/constants');
const riskC = require('./constants');

const REGION = 'southamerica-east1';
const TIME_ZONE = 'America/Fortaleza';
const DRIVER_LIMIT = 1500;

function vehicle(driver) {
  return driver?.vehicleType === 'moto' ? 'moto' : 'car';
}

function hasUsableDispatchLocation(driver, timestampMs) {
  if (!hasFreshAvailabilitySession(driver, timestampMs)) return false;
  if (!driverLocation(driver)) return false;
  const ageMs = locationAgeMs(driver, timestampMs);
  return ageMs <= ONLINE_STALE_FALLBACK_MAX_AGE_MS;
}

function canReceiveGenericLaunchRide(driver, timestampMs) {
  if (driver?.activeRideId || !hasUsableDispatchLocation(driver, timestampMs)) return false;
  const eligibility = evaluateRideEligibility(driver, { now: () => timestampMs });
  if (!eligibility.canReceiveRides) return false;

  // Standard-commission drivers need a usable wallet. Commission-free drivers may
  // remain dispatchable with R$ 0 because acceptOffer intentionally skips the hold.
  const walletUsable = eligibility.commissionFree
    || Number(driver?.walletAvailableCentavos || 0) > rideC.MIN_WALLET_BALANCE_CENTAVOS;
  return walletUsable;
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
    const approved = driver?.verificationStatus === 'approved' && driver?.isBlocked !== true;
    if (approved) {
      result.approved[type] += 1;
      result.approved.total += 1;
    }

    // “Online” means an actual fresh work session, not a stale Firestore string.
    if (!approved || !hasFreshAvailabilitySession(driver, timestampMs)) return;
    result.online[type] += 1;
    result.online.total += 1;
    if (driver?.activeRideId) {
      result.busy[type] += 1;
      result.busy.total += 1;
    } else if (canReceiveGenericLaunchRide(driver, timestampMs)) {
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
    availableCount: aggregate.available.total,
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
  hasUsableDispatchLocation,
  canReceiveGenericLaunchRide,
  buildSupplySnapshot,
  hourSnapshotId,
  recordSupplySnapshot,
  supplySnapshotTask,
};
