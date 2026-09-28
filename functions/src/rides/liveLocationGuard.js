// @ts-check
// Ride live-location guard. Keeps the passenger's map moving for EVERY installed
// driver build, car and moto alike, and makes every silence measurable.
//
// Field incident 2026-09-27 (rides HFylxOysYi1nU7WhmSdZ, tfVX3GPnibYG1OMTCo60):
// passengers cancelled 8-9 min after acceptance with driver_delayed /
// driver_not_moving, and confirmed they never saw the driver approach. Causes
// found in the driver app (fixed client-side in a later build):
//  - the dedicated ride point (activeRideLocations/{rideId}) is started ONCE,
//    when the active-ride screen mounts. On any failure the app rolls back to
//    the online work session, which keeps writing drivers/{id}.location (rules
//    allow it: availabilityStatus stays 'online' during a ride) but never the
//    ride point. Nothing retries.
//  - in ride mode Android samples only after 10 m of movement, so a stopped
//    driver sends nothing at all.
//
// This guard is server-side only, so it works without a new AAB:
//  1. MIRROR  - when the accepted driver's own session-bound point is newer than
//     the ride point, copy it onto the ride point. The copy keeps the SERVER time
//     of the driver write: freshness is never fabricated and the passenger map
//     keeps showing the true age of what it draws.
//  2. MONITOR - every minute, a ride point older than STALE_AFTER_MS (or kept
//     alive only by the mirror) opens an incident in rideTrackingHealth/{rideId}.
//     During the approach ('assigned') the driver gets a bounded alert and the
//     passenger one honest reassurance. Both are re-checked at delivery time.
//
// Contract with the client rules: the ride point holds EXACTLY the nine
// liveLocationKeys(). Clients write it with merge + hasOnly(), so any extra
// server field would make every later client write fail. Observability lives in
// rideTrackingHealth (server-only: no uid, no coordinates) instead.

const admin = require('firebase-admin');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { timestampMs } = require('../drivers/dispatchReadiness');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const { createLoggerContext, logInfo, logWarning, shortHash } = require('../logging/logger');
const C = require('./constants');

const REGION = 'southamerica-east1';

// Same set as the rules' rideIsLocationActive() and the client's
// ACTIVE_TRACKING_RIDE_STATUSES.
const LOCATION_ACTIVE_STATUSES = Object.freeze(['assigned', 'driver_arrived', 'in_progress']);
const LOCATION_ACTIVE = new Set(LOCATION_ACTIVE_STATUSES);

// The passenger map flags a point as outdated after 30 s. One monitor minute of
// margin on top of a healthy 8-15 s ride cadence.
const STALE_AFTER_MS = 45_000;
// A mirrored point this recent means the driver's dedicated ride channel is not
// writing: the car moves, but only at the online cadence (about once a minute).
const RELAY_WINDOW_MS = 90_000;
const PASSENGER_NOTICE_AFTER_MS = 60_000;
const DRIVER_ALERT_COOLDOWN_MS = 3 * 60_000;
// The driver is driving during the approach: two alerts per ride, never more.
const MAX_DRIVER_ALERTS_PER_RIDE = 2;
const DRIVER_ALERT_TTL_MS = 2 * 60_000;
const PASSENGER_NOTICE_TTL_MS = 3 * 60_000;
// A healthy client writes the ride point, then the same point on its profile a
// few hundred ms later. That is the same fix, not a newer one.
const SAME_POINT_WINDOW_MS = 15_000;
const MIN_ADVANCE_MS = 1_000;
// Active rides are a handful at pilot scale; bounded per status per run.
const SCAN_LIMIT_PER_STATUS = 50;
// A ride still "moving" hours after acceptance is abandoned data (test ride,
// app never closed it), not a passenger waiting: never alert or write for it.
const MAX_WATCH_AFTER_ACCEPT_MS = 3 * 60 * 60_000;

const INCIDENT_STATES = new Set(['stale', 'relayed']);
const RIDE_LOCATION_ALERT_EVENTS = new Set([
  C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE,
  C.NOTIFICATION_EVENT.RIDE_LOCATION_DELAYED,
]);

function validPoint(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function optionalNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function samePoint(a, b) {
  return Boolean(a && b)
    && Math.abs(a.lat - b.lat) < 1e-7
    && Math.abs(a.lng - b.lng) < 1e-7;
}

// Server time of the current ride point (updatedAt), falling back to updatedAtMs.
function ridePointMs(tracking) {
  return tracking ? timestampMs(tracking, 'updatedAt') : 0;
}

function vehicleTypeFor(tracking, driver) {
  if (tracking?.vehicleType === 'moto' || tracking?.vehicleType === 'car') return tracking.vehicleType;
  return driver?.vehicleType === 'moto' ? 'moto' : 'car';
}

/**
 * True when the ride point already shows this fix or a newer one. A healthy
 * client writes the ride point first and the same fix on its profile a moment
 * later: that must never count as a new point.
 */
function ridePointIsCurrent(tracking, driverPoint, driverPointMs) {
  if (!tracking) return false;
  const currentMs = ridePointMs(tracking);
  if (driverPointMs <= currentMs + MIN_ADVANCE_MS) return true;
  return samePoint(validPoint(tracking.location), driverPoint)
    && driverPointMs - currentMs < SAME_POINT_WINDOW_MS;
}

/**
 * Pure decision: should the accepted driver's profile point replace the ride
 * point the passenger sees?
 *
 * @param {{rideId:string, ride:object|null, driverId:string, driver:object|null, tracking:object|null}} p
 */
function planRidePointMirror({ rideId, ride, driverId, driver, tracking }) {
  if (!ride || !LOCATION_ACTIVE.has(ride.status)) return { mirror: false, reason: 'ride_not_active' };
  if (!driverId || ride.acceptedDriverId !== driverId) return { mirror: false, reason: 'not_accepted_driver' };
  if (!driver || driver.activeRideId !== rideId) return { mirror: false, reason: 'driver_not_on_ride' };

  // Only a point bound to the work session frozen at acceptance. A point from
  // another session or device must never be drawn on this passenger's map.
  const expectedSession = ride.acceptedAvailabilitySessionId || driver.availabilitySessionId || null;
  if (!expectedSession || driver.locationAvailabilitySessionId !== expectedSession) {
    return { mirror: false, reason: 'session_mismatch' };
  }

  const point = validPoint(driver.location);
  // Server time set by the rules (request.time): immune to a wrong phone clock.
  const driverPointMs = Math.floor(timestampMs(driver, 'locationUpdatedAt'));
  if (!point || !(driverPointMs > 0)) return { mirror: false, reason: 'no_driver_point' };

  const currentMs = ridePointMs(tracking);
  if (ridePointIsCurrent(tracking, point, driverPointMs)) {
    return { mirror: false, reason: 'ride_point_current', ridePointMs: currentMs };
  }

  return {
    mirror: true,
    reason: tracking ? 'driver_point_newer' : 'ride_point_missing',
    pointMs: driverPointMs,
    previousMs: currentMs,
    // Exactly liveLocationKeys(): see the contract note at the top of the file.
    payload: {
      rideId,
      driverId,
      vehicleType: vehicleTypeFor(tracking, driver),
      location: point,
      accuracyMeters: optionalNumber(driver.locationAccuracyMeters),
      headingDegrees: optionalNumber(driver.locationHeadingDegrees),
      speedMps: optionalNumber(driver.locationSpeedMps),
      updatedAtMs: driverPointMs,
      updatedAt: admin.firestore.Timestamp.fromMillis(driverPointMs),
    },
  };
}

// Which app build produced the incident: the data that decides when to raise
// the minimum required build. A build number is not personal data.
function driverBuildNumber(driver) {
  const build = Number(driver?.availabilityClientBuildNumber);
  return Number.isInteger(build) && build > 0 ? build : null;
}

function mirrorCounters(previous, nowMs, source) {
  return {
    mirroredPoints: Number(previous?.mirroredPoints || 0) + 1,
    firstMirroredAtMs: Number(previous?.firstMirroredAtMs || 0) || nowMs,
    lastMirroredAtMs: nowMs,
    lastMirrorSource: source,
  };
}

function refs(db, rideId, driverId) {
  return {
    ride: db.collection(C.RIDE_REQUESTS).doc(rideId),
    driver: driverId ? db.collection(C.DRIVERS).doc(driverId) : null,
    tracking: db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(rideId),
    health: db.collection(C.RIDE_TRACKING_HEALTH).doc(rideId),
  };
}

async function readData(tx, ref) {
  if (!ref) return null;
  const snap = await tx.get(ref);
  return snap.exists ? snap.data() || {} : null;
}

/**
 * Trigger path: a fresh profile point from a driver on a ride. Transactional so
 * a ride that ends concurrently (lifecycle deletes the ride point in its own
 * transaction) can never get its point recreated.
 */
async function mirrorDriverPointToRide({ db, driverId, rideId, nowMs, context, source = 'driver_point' }) {
  const r = refs(db, rideId, driverId);
  const result = await db.runTransaction(async (tx) => {
    const ride = await readData(tx, r.ride);
    const driver = await readData(tx, r.driver);
    const tracking = await readData(tx, r.tracking);
    const health = await readData(tx, r.health);
    const plan = planRidePointMirror({ rideId, ride, driverId, driver, tracking });
    if (!plan.mirror) return { outcome: 'skipped', reason: plan.reason };

    tx.set(r.tracking, plan.payload, { merge: true });
    tx.set(r.health, {
      rideId,
      rideStatus: ride.status,
      vehicleType: plan.payload.vehicleType,
      driverBuildNumber: driverBuildNumber(driver),
      ...mirrorCounters(health, nowMs, source),
      updatedAtMs: nowMs,
    }, { merge: true });
    return {
      outcome: 'mirrored',
      reason: plan.reason,
      rideStatus: ride.status,
      gapMs: plan.previousMs > 0 ? Math.max(0, plan.pointMs - plan.previousMs) : null,
    };
  });

  // Committed transitions only. No coordinates, no raw uid.
  if (result.outcome === 'mirrored') {
    logInfo(context, 'ride.live_point.mirrored', {
      rideId, driverIdHash: shortHash(driverId), rideStatus: result.rideStatus,
      reason: result.reason, source, gapMs: result.gapMs,
    });
  }
  return result;
}

function driverPointAdvanced(before = {}, after = {}) {
  if (typeof after.activeRideId !== 'string' || !after.activeRideId) return false;
  return timestampMs(after, 'locationUpdatedAt') > timestampMs(before, 'locationUpdatedAt');
}

/**
 * Monitor path for one active ride: mirror if possible, then classify the ride
 * point as healthy / relayed / stale and act on incidents.
 */
async function reconcileRideLiveLocation({ db, rideId, nowMs, context }) {
  const rideRef = db.collection(C.RIDE_REQUESTS).doc(rideId);
  const result = await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    const ride = rideSnap.exists ? rideSnap.data() || {} : null;
    if (!ride || !LOCATION_ACTIVE.has(ride.status) || !ride.acceptedDriverId) {
      return { outcome: 'skipped' };
    }
    const acceptedAtMs = Number(ride.acceptedAtMs || 0);
    if (acceptedAtMs > 0 && nowMs - acceptedAtMs > MAX_WATCH_AFTER_ACCEPT_MS) {
      return { outcome: 'abandoned' };
    }
    const driverId = ride.acceptedDriverId;
    const r = refs(db, rideId, driverId);
    const driver = await readData(tx, r.driver);
    const tracking = await readData(tx, r.tracking);
    const healthSnap = await tx.get(r.health);
    const previous = healthSnap.exists ? healthSnap.data() || {} : {};

    const plan = planRidePointMirror({ rideId, ride, driverId, driver, tracking });
    const mirroredNow = plan.mirror === true;
    if (mirroredNow) tx.set(r.tracking, plan.payload, { merge: true });

    // No point at all yet: count from the acceptance, never from nothing.
    const pointMs = mirroredNow ? plan.pointMs : ridePointMs(tracking);
    const referenceMs = pointMs || Number(ride.acceptedAtMs || 0);
    const gapMs = referenceMs > 0 ? Math.max(0, nowMs - referenceMs) : null;
    const lastMirroredAtMs = mirroredNow ? nowMs : Number(previous.lastMirroredAtMs || 0);
    const relayed = lastMirroredAtMs > 0 && nowMs - lastMirroredAtMs <= RELAY_WINDOW_MS;
    const state = gapMs == null || gapMs > STALE_AFTER_MS ? 'stale' : relayed ? 'relayed' : 'healthy';
    const incident = INCIDENT_STATES.has(state);
    const previousIncident = INCIDENT_STATES.has(previous.state);

    const update = {
      rideId,
      rideStatus: ride.status,
      vehicleType: vehicleTypeFor(tracking, driver),
      driverBuildNumber: driverBuildNumber(driver),
      state,
      gapMs,
      lastCheckedAtMs: nowMs,
      firstCheckedAtMs: Number(previous.firstCheckedAtMs || 0) || nowMs,
      updatedAtMs: nowMs,
      ...(mirroredNow ? mirrorCounters(previous, nowMs, 'monitor') : {}),
    };

    let driverAlert = false;
    let passengerNotice = false;
    let incidentNumber = Number(previous.incidentNumber || 0);

    if (incident) {
      const newIncident = !previousIncident;
      if (newIncident) incidentNumber += 1;
      const alertsSent = Number(previous.driverAlertCount || 0);
      const lastAlertAtMs = Number(previous.lastDriverAlertAtMs || 0);
      // Approach only: in driver_arrived the car waits at the pickup on purpose,
      // and in in_progress the passenger is already inside the car.
      driverAlert = ride.status === C.RIDE_STATUS.ASSIGNED
        && alertsSent < MAX_DRIVER_ALERTS_PER_RIDE
        && (lastAlertAtMs === 0 || nowMs - lastAlertAtMs >= DRIVER_ALERT_COOLDOWN_MS);
      // Reassure only when the car really does not move ('relayed' still moves).
      passengerNotice = ride.status === C.RIDE_STATUS.ASSIGNED
        && state === 'stale'
        && (gapMs == null || gapMs >= PASSENGER_NOTICE_AFTER_MS)
        && !previous.passengerNoticeAtMs
        && typeof ride.passengerId === 'string' && ride.passengerId.length > 0;

      Object.assign(update, {
        incidentNumber,
        incidentDetectedAtMs: newIncident ? nowMs : Number(previous.incidentDetectedAtMs || nowMs),
        incidentRideStatus: newIncident ? ride.status : (previous.incidentRideStatus || ride.status),
        staleChecks: Number(previous.staleChecks || 0) + (state === 'stale' ? 1 : 0),
        maxGapMs: Math.max(Number(previous.maxGapMs || 0), gapMs || 0),
        driverAlertCount: alertsSent + (driverAlert ? 1 : 0),
        lastDriverAlertAtMs: driverAlert ? nowMs : lastAlertAtMs,
        ...(passengerNotice ? { passengerNoticeAtMs: nowMs } : {}),
      });

      if (driverAlert) {
        const event = buildNotificationEvent({
          rideId, eventType: C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE,
          recipientUid: driverId, recipientRole: 'driver', route: '/active-ride',
          nowMs, expiresAtMs: nowMs + DRIVER_ALERT_TTL_MS,
          dedupeSuffix: `driver_${incidentNumber}_${alertsSent + 1}`,
        });
        // Kept in the private outbox for the delivery-time check, never in FCM data.
        event.data.incidentNumber = incidentNumber;
        enqueueEventTx(tx, db, event);
      }
      if (passengerNotice) {
        const event = buildNotificationEvent({
          rideId, eventType: C.NOTIFICATION_EVENT.RIDE_LOCATION_DELAYED,
          recipientUid: ride.passengerId, recipientRole: 'passenger', route: '/driver-accepted',
          nowMs, expiresAtMs: nowMs + PASSENGER_NOTICE_TTL_MS,
        });
        enqueueEventTx(tx, db, event);
      }
    } else if (previousIncident) {
      Object.assign(update, {
        recoveredAtMs: nowMs,
        lastIncidentDurationMs: Math.max(0, nowMs - Number(previous.incidentDetectedAtMs || nowMs)),
      });
    }

    // Healthy rides are written once (proof the ride was watched), then only on
    // change, so a normal ride costs one health write.
    if (!healthSnap.exists || incident || previousIncident || mirroredNow) {
      tx.set(r.health, update, { merge: true });
    }

    return {
      outcome: incident ? state : previousIncident ? 'recovered' : 'healthy',
      rideStatus: ride.status,
      driverId,
      mirrored: mirroredNow,
      driverAlert,
      passengerNotice,
      gapMs,
      incidentNumber,
    };
  });

  if (!['skipped', 'abandoned'].includes(result.outcome) && (result.outcome !== 'healthy' || result.mirrored)) {
    const log = result.outcome === 'stale' ? logWarning : logInfo;
    log(context, `ride.live_point.${result.outcome}`, {
      rideId, driverIdHash: shortHash(result.driverId), rideStatus: result.rideStatus,
      gapMs: result.gapMs, mirrored: result.mirrored, driverAlert: result.driverAlert,
      passengerNotice: result.passengerNotice, incidentNumber: result.incidentNumber,
    });
  }
  return result;
}

async function monitorRideLiveLocation({ db, nowMs, context }) {
  const summary = {
    scanned: 0, healthy: 0, relayed: 0, stale: 0, recovered: 0, abandoned: 0,
    mirrored: 0, driverAlerts: 0, passengerNotices: 0, failed: 0,
  };
  for (const status of LOCATION_ACTIVE_STATUSES) {
    const snap = await db.collection(C.RIDE_REQUESTS)
      .where('status', '==', status).limit(SCAN_LIMIT_PER_STATUS).get();
    for (const document of snap.docs) {
      summary.scanned += 1;
      try {
        const result = await reconcileRideLiveLocation({ db, rideId: document.id, nowMs, context });
        if (Object.prototype.hasOwnProperty.call(summary, result.outcome)) summary[result.outcome] += 1;
        if (result.mirrored) summary.mirrored += 1;
        if (result.driverAlert) summary.driverAlerts += 1;
        if (result.passengerNotice) summary.passengerNotices += 1;
      } catch (error) {
        summary.failed += 1;
        logWarning(context, 'ride.live_point_monitor.failed', {
          rideId: document.id, reason: error?.code || 'unknown',
        });
      }
    }
  }
  // Quiet when there is nothing to watch: one line per minute only while rides run.
  if (summary.scanned > 0) logInfo(context, 'ride.live_point_monitor.completed', summary);
  return summary;
}

/**
 * Delivery-time check (processEvent): an alert written a minute ago may be
 * obsolete now. Never wake a driver or passenger for a map that already moves.
 */
function shouldSendRideLocationAlert({ ride, tracking, health, event, nowMs }) {
  if (!ride || !event || !(Number(event.expiresAtMs) > nowMs)) return false;
  if (ride.status !== C.RIDE_STATUS.ASSIGNED) return false;
  if (event.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_STALE) {
    return ride.acceptedDriverId === event.recipientUid
      && INCIDENT_STATES.has(health?.state)
      && Number(health?.incidentNumber) === Number(event.incidentNumber);
  }
  if (event.eventType === C.NOTIFICATION_EVENT.RIDE_LOCATION_DELAYED) {
    const pointMs = ridePointMs(tracking) || Number(ride.acceptedAtMs || 0);
    return ride.passengerId === event.recipientUid
      && pointMs > 0 && nowMs - pointMs > STALE_AFTER_MS;
  }
  return false;
}

const rideLocationMirrorTrigger = onDocumentUpdated(
  { document: 'drivers/{driverId}', region: REGION, retry: false },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!driverPointAdvanced(before, after)) return null;

    const driverId = event.params.driverId;
    const rideId = after.activeRideId;
    const db = event.data.after.ref.firestore;
    const context = createLoggerContext({ functionName: 'rideLocationMirrorTrigger', actorType: 'system' });
    try {
      // Healthy rides (the vast majority) exit on one plain read: no transaction,
      // no lock on the documents the driver app is writing every few seconds.
      const trackingSnap = await db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(rideId).get();
      if (trackingSnap.exists && ridePointIsCurrent(
        trackingSnap.data() || {},
        validPoint(after.location),
        Math.floor(timestampMs(after, 'locationUpdatedAt'))
      )) return null;

      await mirrorDriverPointToRide({ db, driverId, rideId, nowMs: Date.now(), context });
    } catch (error) {
      // Best effort: the minute monitor retries the same mirror.
      logWarning(context, 'ride.live_point.mirror_failed', {
        rideId, driverIdHash: shortHash(driverId), reason: error?.code || 'unknown',
      });
    }
    return null;
  }
);

const monitorRideLiveLocationTask = onSchedule({
  region: REGION, schedule: 'every 1 minutes', timeZone: 'America/Fortaleza',
  retryCount: 0, maxInstances: 1, timeoutSeconds: 60,
}, () => {
  const nowMs = Date.now();
  return monitorRideLiveLocation({
    db: admin.firestore(),
    nowMs,
    context: { traceId: `ride-live-point-${nowMs}`, functionName: 'monitorRideLiveLocationTask' },
  });
});

module.exports = {
  LOCATION_ACTIVE_STATUSES,
  STALE_AFTER_MS,
  RELAY_WINDOW_MS,
  PASSENGER_NOTICE_AFTER_MS,
  DRIVER_ALERT_COOLDOWN_MS,
  MAX_DRIVER_ALERTS_PER_RIDE,
  RIDE_LOCATION_ALERT_EVENTS,
  planRidePointMirror,
  ridePointIsCurrent,
  driverPointAdvanced,
  mirrorDriverPointToRide,
  reconcileRideLiveLocation,
  monitorRideLiveLocation,
  shouldSendRideLocationAlert,
  rideLocationMirrorTrigger,
  monitorRideLiveLocationTask,
};
