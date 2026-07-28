'use strict';

// Retryable, idempotent Firestore projections for driver acceptance/completion
// rates. Source documents carry deterministic applied-version markers, while the
// aggregate remains server-owned on drivers/{uid}. No passenger identity, address
// or financial amount is copied into the performance object.

const admin = require('firebase-admin');
const {
  onDocumentCreated,
  onDocumentUpdated,
} = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const C = require('../rides/constants');
const {
  DRIVER_PERFORMANCE_STATS_VERSION,
  nextOfferReceivedStats,
  nextOfferAcceptedStats,
  nextTerminalRideStats,
} = require('./performanceStats');

const REGION = 'southamerica-east1';
const OFFER_RECEIVED_MARKER = 'driverOfferReceivedStatsAppliedVersion';
const OFFER_ACCEPTED_MARKER = 'driverOfferAcceptedStatsAppliedVersion';
const RIDE_TERMINAL_MARKER = 'driverRideTerminalStatsAppliedVersion';

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function offerAcceptedTransition(before = {}, after = {}) {
  return after.status === C.OFFER_STATUS.ACCEPTED
    && before.status !== C.OFFER_STATUS.ACCEPTED
    && Boolean(after.driverId);
}

function terminalRideTransition(before = {}, after = {}) {
  const terminal = after.status === C.RIDE_STATUS.COMPLETED
    || after.status === C.RIDE_STATUS.CANCELLED;
  return terminal && before.status !== after.status && Boolean(after.acceptedDriverId);
}

function ridePerformanceOutcome(ride = {}) {
  if (ride.status === C.RIDE_STATUS.COMPLETED) return 'completed';
  if (ride.status !== C.RIDE_STATUS.CANCELLED) return null;
  if (ride.cancelledBy === 'passenger' || ride.cancelReasonCode === 'passenger_no_show') {
    return 'excluded_cancelled';
  }
  return 'driver_cancelled';
}

async function applyOfferReceivedStats({ db, offerId, context, clock = { now: Date.now } }) {
  const offerRef = db.collection(C.DRIVER_OFFERS).doc(offerId);
  const result = await db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists) return { action: 'offer_missing' };
    const offer = offerSnap.data() || {};
    if (offer[OFFER_RECEIVED_MARKER] === DRIVER_PERFORMANCE_STATS_VERSION) {
      return { action: 'duplicate_ignored' };
    }
    if (!offer.driverId) return { action: 'driver_missing_on_offer' };

    const driverRef = db.collection(C.DRIVERS).doc(offer.driverId);
    const driverSnap = await tx.get(driverRef);
    if (!driverSnap.exists) return { action: 'driver_profile_missing' };
    const driver = driverSnap.data() || {};
    const nowMs = Number(clock.now());
    const stats = nextOfferReceivedStats(driver.driverPerformanceStats, nowMs);

    tx.set(driverRef, {
      driverPerformanceStats: stats,
      updatedAt: ts(),
    }, { merge: true });
    tx.set(offerRef, {
      [OFFER_RECEIVED_MARKER]: DRIVER_PERFORMANCE_STATS_VERSION,
      driverOfferReceivedStatsAppliedAtMs: nowMs,
      driverOfferReceivedStatsAppliedAt: ts(),
      updatedAt: ts(),
    }, { merge: true });
    return { action: 'succeeded', stats };
  });

  logInfo(context, 'driver.performance.offer_received', {
    operation: 'aggregate_driver_performance',
    offerId,
    statsVersion: DRIVER_PERFORMANCE_STATS_VERSION,
    result: result.action,
    offersReceivedCount: result.stats?.offersReceivedCount,
  });
  return result;
}

async function applyOfferAcceptedStats({ db, offerId, context, clock = { now: Date.now } }) {
  const offerRef = db.collection(C.DRIVER_OFFERS).doc(offerId);
  const result = await db.runTransaction(async (tx) => {
    const offerSnap = await tx.get(offerRef);
    if (!offerSnap.exists) return { action: 'offer_missing' };
    const offer = offerSnap.data() || {};
    if (offer.status !== C.OFFER_STATUS.ACCEPTED) return { action: 'offer_not_accepted' };
    if (offer[OFFER_ACCEPTED_MARKER] === DRIVER_PERFORMANCE_STATS_VERSION) {
      return { action: 'duplicate_ignored' };
    }
    if (!offer.driverId) return { action: 'driver_missing_on_offer' };

    const driverRef = db.collection(C.DRIVERS).doc(offer.driverId);
    const driverSnap = await tx.get(driverRef);
    if (!driverSnap.exists) return { action: 'driver_profile_missing' };
    const driver = driverSnap.data() || {};
    const nowMs = Number(clock.now());

    // Trigger delivery order is not guaranteed. If the create event has not yet
    // been projected, apply received + accepted atomically and mark both.
    const receivedAlreadyApplied =
      offer[OFFER_RECEIVED_MARKER] === DRIVER_PERFORMANCE_STATS_VERSION;
    const withReceived = receivedAlreadyApplied
      ? driver.driverPerformanceStats
      : nextOfferReceivedStats(driver.driverPerformanceStats, nowMs);
    const stats = nextOfferAcceptedStats(withReceived, nowMs);

    tx.set(driverRef, {
      driverPerformanceStats: stats,
      updatedAt: ts(),
    }, { merge: true });
    tx.set(offerRef, {
      [OFFER_RECEIVED_MARKER]: DRIVER_PERFORMANCE_STATS_VERSION,
      [OFFER_ACCEPTED_MARKER]: DRIVER_PERFORMANCE_STATS_VERSION,
      driverOfferReceivedStatsAppliedAtMs:
        Number(offer.driverOfferReceivedStatsAppliedAtMs || 0) || nowMs,
      driverOfferAcceptedStatsAppliedAtMs: nowMs,
      driverOfferAcceptedStatsAppliedAt: ts(),
      updatedAt: ts(),
    }, { merge: true });
    return { action: 'succeeded', stats, receivedRecovered: !receivedAlreadyApplied };
  });

  logInfo(context, 'driver.performance.offer_accepted', {
    operation: 'aggregate_driver_performance',
    offerId,
    statsVersion: DRIVER_PERFORMANCE_STATS_VERSION,
    result: result.action,
    receivedRecovered: result.receivedRecovered === true,
    offersAcceptedCount: result.stats?.offersAcceptedCount,
  });
  return result;
}

async function applyTerminalRideStats({ db, rideId, context, clock = { now: Date.now } }) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const result = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) return { action: 'ride_missing' };
    const ride = rideSnap.data() || {};
    if (![C.RIDE_STATUS.COMPLETED, C.RIDE_STATUS.CANCELLED].includes(ride.status)) {
      return { action: 'ride_not_terminal' };
    }
    if (ride[RIDE_TERMINAL_MARKER] === DRIVER_PERFORMANCE_STATS_VERSION) {
      return { action: 'duplicate_ignored' };
    }
    if (!ride.acceptedDriverId) return { action: 'driver_missing_on_ride' };

    const driverRef = db.collection(C.DRIVERS).doc(ride.acceptedDriverId);
    const driverSnap = await tx.get(driverRef);
    if (!driverSnap.exists) return { action: 'driver_profile_missing' };
    const driver = driverSnap.data() || {};
    const nowMs = Number(clock.now());
    const performanceOutcome = ridePerformanceOutcome(ride);
    const stats = nextTerminalRideStats(
      driver.driverPerformanceStats,
      performanceOutcome,
      nowMs
    );

    tx.set(driverRef, {
      driverPerformanceStats: stats,
      updatedAt: ts(),
    }, { merge: true });
    tx.set(rideRef, {
      [RIDE_TERMINAL_MARKER]: DRIVER_PERFORMANCE_STATS_VERSION,
      driverRideTerminalStatsOutcome: performanceOutcome,
      driverRideTerminalStatsAppliedAtMs: nowMs,
      driverRideTerminalStatsAppliedAt: ts(),
      updatedAt: ts(),
    }, { merge: true });
    return {
      action: 'succeeded',
      stats,
      terminalStatus: ride.status,
      performanceOutcome,
    };
  });

  logInfo(context, 'driver.performance.ride_terminal', {
    operation: 'aggregate_driver_performance',
    rideId,
    statsVersion: DRIVER_PERFORMANCE_STATS_VERSION,
    result: result.action,
    terminalStatus: result.terminalStatus,
    performanceOutcome: result.performanceOutcome,
    terminalRideCount: result.stats?.terminalRideCount,
  });
  return result;
}

function triggerContext(functionName) {
  return createLoggerContext({ functionName, actorType: 'system' });
}

const driverOfferReceivedStatsTrigger = onDocumentCreated(
  {
    document: `${C.DRIVER_OFFERS}/{offerId}`,
    region: REGION,
    retry: true,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const context = triggerContext('driverOfferReceivedStatsTrigger');
    try {
      await applyOfferReceivedStats({
        db: event.data.ref.firestore,
        offerId: event.params.offerId,
        context,
      });
    } catch (error) {
      logWarning(context, 'driver.performance.offer_received_failed', {
        operation: 'aggregate_driver_performance',
        offerId: event.params.offerId,
        errorCode: error?.code || error?.name || 'OFFER_RECEIVED_STATS_FAILED',
      });
      throw error;
    }
    return null;
  }
);

const driverOfferAcceptedStatsTrigger = onDocumentUpdated(
  {
    document: `${C.DRIVER_OFFERS}/{offerId}`,
    region: REGION,
    retry: true,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!offerAcceptedTransition(before, after)) return null;
    const context = triggerContext('driverOfferAcceptedStatsTrigger');
    try {
      await applyOfferAcceptedStats({
        db: event.data.after.ref.firestore,
        offerId: event.params.offerId,
        context,
      });
    } catch (error) {
      logWarning(context, 'driver.performance.offer_accepted_failed', {
        operation: 'aggregate_driver_performance',
        offerId: event.params.offerId,
        errorCode: error?.code || error?.name || 'OFFER_ACCEPTED_STATS_FAILED',
      });
      throw error;
    }
    return null;
  }
);

const driverTerminalRideStatsTrigger = onDocumentUpdated(
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
    if (!terminalRideTransition(before, after)) return null;
    const context = triggerContext('driverTerminalRideStatsTrigger');
    try {
      await applyTerminalRideStats({
        db: event.data.after.ref.firestore,
        rideId: event.params.rideId,
        context,
      });
    } catch (error) {
      logWarning(context, 'driver.performance.ride_terminal_failed', {
        operation: 'aggregate_driver_performance',
        rideId: event.params.rideId,
        errorCode: error?.code || error?.name || 'TERMINAL_RIDE_STATS_FAILED',
      });
      throw error;
    }
    return null;
  }
);

module.exports = {
  OFFER_RECEIVED_MARKER,
  OFFER_ACCEPTED_MARKER,
  RIDE_TERMINAL_MARKER,
  offerAcceptedTransition,
  terminalRideTransition,
  ridePerformanceOutcome,
  applyOfferReceivedStats,
  applyOfferAcceptedStats,
  applyTerminalRideStats,
  driverOfferReceivedStatsTrigger,
  driverOfferAcceptedStatsTrigger,
  driverTerminalRideStatsTrigger,
};
