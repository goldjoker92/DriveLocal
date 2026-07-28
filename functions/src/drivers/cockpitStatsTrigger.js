'use strict';

// Updates compact cockpit counters after a ride reaches completed. The trigger is
// retryable and idempotent: one private marker on the ride prevents duplicate fare
// or ride-count increments when Firestore redelivers the same event.

const admin = require('firebase-admin');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const C = require('../rides/constants');
const {
  COCKPIT_STATS_VERSION,
  nextDriverCockpitStats,
} = require('./cockpitStats');

const REGION = 'southamerica-east1';

function cockpitStatsUpdateNeeded(before = {}, after = {}) {
  return Boolean(
    after.status === C.RIDE_STATUS.COMPLETED
    && before.status !== C.RIDE_STATUS.COMPLETED
    && after.acceptedDriverId
  );
}

function completedRideFareCentavos(ride = {}) {
  const candidates = [
    ride.finalFareCentavos,
    ride.paymentAmountCentavos,
    ride.estimatedFareCentavos,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
  }
  return 0;
}

async function applyCompletedRideToCockpit({ db, rideId, context, clock = { now: Date.now } }) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const result = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) return { action: 'ride_missing' };

    const ride = rideSnap.data() || {};
    if (ride.status !== C.RIDE_STATUS.COMPLETED) return { action: 'ride_not_completed' };
    if (ride.cockpitStatsAppliedVersion === COCKPIT_STATS_VERSION) {
      return { action: 'duplicate_ignored' };
    }
    if (!ride.acceptedDriverId) return { action: 'driver_missing_on_ride' };

    const driverRef = db.collection(C.DRIVERS).doc(ride.acceptedDriverId);
    const driverSnap = await tx.get(driverRef);
    if (!driverSnap.exists) return { action: 'driver_profile_missing' };

    const driver = driverSnap.data() || {};
    const completedAtMs = Number(ride.completedAtMs || 0) || Number(clock.now());
    const rideFareCentavos = completedRideFareCentavos(ride);
    const cockpitStats = nextDriverCockpitStats(
      driver.cockpitStats,
      completedAtMs,
      rideFareCentavos
    );

    tx.set(driverRef, {
      cockpitStats,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(rideRef, {
      cockpitStatsAppliedVersion: COCKPIT_STATS_VERSION,
      cockpitStatsAppliedAtMs: Number(clock.now()),
      cockpitStatsAppliedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      action: 'succeeded',
      cockpitStats,
      rideFareCentavos,
    };
  });

  const metadata = {
    operation: 'aggregate_driver_cockpit',
    rideId,
    statsVersion: COCKPIT_STATS_VERSION,
    result: result.action,
    dayKey: result.cockpitStats?.dayKey,
    weekKey: result.cockpitStats?.weekKey,
    todayRideCount: result.cockpitStats?.todayRideCount,
    weekRideCount: result.cockpitStats?.weekRideCount,
    rideFareCentavos: result.rideFareCentavos,
  };
  if (result.action === 'duplicate_ignored') {
    logInfo(context, 'driver.cockpit_stats.duplicate_ignored', metadata);
  } else if (result.action === 'driver_profile_missing') {
    logWarning(context, 'driver.cockpit_stats.driver_missing', metadata);
  } else {
    logInfo(context, 'driver.cockpit_stats.completed', metadata);
  }
  return result;
}

const driverCockpitStatsTrigger = onDocumentUpdated(
  {
    document: `${C.RIDE_REQUESTS}/{rideId}`,
    region: REGION,
    retry: true,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!cockpitStatsUpdateNeeded(before, after)) return null;

    const context = createLoggerContext({
      functionName: 'driverCockpitStatsTrigger',
      actorType: 'system',
    });
    logInfo(context, 'driver.cockpit_stats.started', {
      operation: 'aggregate_driver_cockpit',
      rideId: event.params.rideId,
      statsVersion: COCKPIT_STATS_VERSION,
    });

    try {
      await applyCompletedRideToCockpit({
        db: event.data.after.ref.firestore,
        rideId: event.params.rideId,
        context,
      });
    } catch (error) {
      logWarning(context, 'driver.cockpit_stats.failed', {
        operation: 'aggregate_driver_cockpit',
        rideId: event.params.rideId,
        statsVersion: COCKPIT_STATS_VERSION,
        errorCode: error?.code || error?.name || 'COCKPIT_STATS_FAILED',
      });
      throw error;
    }
    return null;
  }
);

module.exports = {
  cockpitStatsUpdateNeeded,
  completedRideFareCentavos,
  applyCompletedRideToCockpit,
  driverCockpitStatsTrigger,
};