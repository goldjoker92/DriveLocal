// Reconcile idle sessions independently of passenger demand. All decisions are
// re-read transactionally: a GPS recovery, new session or accepted ride wins
// over an older scan. One short-lived personal alert per interruption.
const crypto = require('crypto');
const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { evaluateDriverDispatchReadiness, timestampMs } = require('./dispatchReadiness');
const { resolveDriverBuildPolicy } = require('./appVersion');
const { buildNotificationEvent, enqueueEventTx } = require('../notifications/events');
const { logInfo, logWarning, shortHash } = require('../logging/logger');
const C = require('../rides/constants');

const SCAN_LIMIT = 100;
const START_GRACE_MS = 90_000;
const ALERT_TTL_MS = 60_000;
const ALERT_COOLDOWN_MS = 15 * 60_000;
const TECHNICAL_REASONS = new Set(['session_stale', 'session_mismatch', 'location_missing', 'location_stale']);

async function reconcileDriverAvailability({ db, driverId, expectedSessionId, nowMs, mode = 'monitor', context }) {
  const ref = db.collection(C.DRIVERS).doc(driverId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { outcome: 'skipped' };
    const driver = snap.data() || {};
    const sessionId = driver.availabilitySessionId || null;
    if (driver.activeRideId || driver.availabilityStatus !== 'online'
      || sessionId !== (expectedSessionId || null)) return { outcome: 'skipped' };
    const config = await tx.get(db.collection(C.CITY_PUBLIC_CONFIG)
      .doc(driver.serviceAreaId || C.DEFAULT_SERVICE_AREA_ID));
    const policy = config.exists ? config.data() || {} : {};
    const state = evaluateDriverDispatchReadiness(driver, { nowMs, driverBuildPolicy: policy });
    const previous = driver.availabilityHealth || {};
    const stamp = admin.firestore.FieldValue.serverTimestamp;

    if (state.ready) {
      if (previous.state === 'unavailable' && previous.sessionId === sessionId) {
        tx.set(ref, { availabilityHealth: { ...previous, state: 'ready', reason: 'ready', recoveredAtMs: nowMs } }, { merge: true });
        return { outcome: 'recovered', reason: 'ready' };
      }
      return { outcome: 'skipped' };
    }
    const abandoned = state.sessionAgeMs > C.WORK_SESSION_ABANDONED_MAX_AGE_MS;
    const unsupported = state.reason === 'app_update_required';
    if (mode === 'abandoned' && !abandoned) return { outcome: 'skipped' };
    if (mode === 'unsupported' && !unsupported) return { outcome: 'skipped' };
    if (mode === 'monitor' && !TECHNICAL_REASONS.has(state.reason)) return { outcome: 'skipped' };

    const startedAtMs = timestampMs(driver, 'availabilitySessionStartedAt');
    if (mode === 'monitor' && startedAtMs > 0 && nowMs - startedAtMs < START_GRACE_MS) {
      return { outcome: 'skipped' };
    }
    const close = abandoned || mode === 'unsupported';
    const reason = mode === 'unsupported' ? 'mandatory_update_required' : state.reason;
    const newIncident = previous.state !== 'unavailable' || previous.sessionId !== sessionId;
    const incidentNumber = Number(previous.incidentNumber || 0) + (newIncident ? 1 : 0);
    const notify = newIncident && TECHNICAL_REASONS.has(state.reason)
      && (!previous.lastNotifiedAtMs || nowMs - previous.lastNotifiedAtMs >= ALERT_COOLDOWN_MS);
    const health = {
      state: 'unavailable', reason, sessionId, incidentNumber,
      sinceMs: newIncident ? nowMs : previous.sinceMs,
      lastNotifiedAtMs: notify ? nowMs : (previous.lastNotifiedAtMs || 0),
    };
    const update = { availabilityHealth: health };
    if (close) Object.assign(update, {
      availabilityStatus: 'offline', availabilitySessionId: null,
      availabilitySessionEndedAtMs: nowMs, availabilitySessionEndedAt: stamp(),
      availabilityUpdatedAtMs: nowMs, availabilityUpdatedAt: stamp(),
      locationAvailabilitySessionId: null, availabilityClientSessionId: null,
      availabilityClosedReason: mode === 'unsupported' ? 'mandatory_update_required' : 'work_session_lease_expired',
      ...(mode === 'unsupported' ? { availabilityRequiredBuildNumber: resolveDriverBuildPolicy(policy).minimumBuildNumber } : {}),
      updatedAt: stamp(),
    });
    if (newIncident || close || previous.reason !== reason) tx.set(ref, update, { merge: true });
    if (notify) {
      const suffix = crypto.createHash('sha256').update(`${driverId}:${sessionId}:${incidentNumber}`).digest('hex').slice(0, 32);
      const event = buildNotificationEvent({
        rideId: 'availability', eventType: C.NOTIFICATION_EVENT.DRIVER_AVAILABILITY_INTERRUPTED,
        recipientUid: driverId, recipientRole: 'driver', route: '/driver-home',
        nowMs, expiresAtMs: nowMs + ALERT_TTL_MS, dedupeSuffix: suffix,
      });
      // Session data stays in the private outbox, never in the FCM data payload.
      event.data.availabilitySessionId = sessionId;
      event.data.incidentNumber = incidentNumber;
      enqueueEventTx(tx, db, event);
    }
    return { outcome: close ? 'closed' : newIncident ? 'interrupted' : 'skipped', notified: notify, reason };
  });
  // Log only committed transitions, never transaction attempts (which retry).
  // Hashes let support correlate one driver/session without logging identities.
  if (result.outcome !== 'skipped') logInfo(context, `driver.availability.${result.outcome}`, {
    driverIdHash: shortHash(driverId), sessionIdHash: shortHash(expectedSessionId),
    reason: result.reason, notified: result.notified === true, mode,
  });
  return result;
}

function shouldSendAvailabilityAlert(driver, event, nowMs) {
  if (!driver || driver.activeRideId || !(event.expiresAtMs > nowMs)) return false;
  const health = driver.availabilityHealth || {};
  if (health.state !== 'unavailable' || health.sessionId !== event.availabilitySessionId
    || health.incidentNumber !== event.incidentNumber) return false;
  if (driver.availabilityStatus === 'offline') {
    return !driver.availabilitySessionId && driver.availabilityClosedReason === 'work_session_lease_expired';
  }
  return driver.availabilitySessionId === event.availabilitySessionId
    && TECHNICAL_REASONS.has(evaluateDriverDispatchReadiness(driver, { nowMs }).reason);
}

async function monitorDriverAvailability({ db, nowMs, context }) {
  // Persistent document-id cursor prevents the first 100 healthy drivers from
  // starving everyone else. A run is bounded even as the fleet grows.
  const cursorRef = db.collection('systemState').doc('driverAvailabilityMonitor');
  const cursorSnap = await cursorRef.get();
  const afterId = cursorSnap.exists ? cursorSnap.data()?.afterId : null;
  let query = db.collection(C.DRIVERS).where('availabilityStatus', '==', 'online')
    .orderBy(admin.firestore.FieldPath.documentId()).limit(SCAN_LIMIT);
  if (afterId) query = query.startAfter(afterId);
  const snap = await query.get();
  const summary = { scanned: snap.size, interrupted: 0, recovered: 0, closed: 0, notified: 0, failed: 0 };
  for (const document of snap.docs) {
    try {
      const result = await reconcileDriverAvailability({
        db, driverId: document.id, expectedSessionId: document.data()?.availabilitySessionId, nowMs, context,
      });
      if (Object.prototype.hasOwnProperty.call(summary, result.outcome)) summary[result.outcome] += 1;
      if (result.notified) summary.notified += 1;
    } catch (error) {
      summary.failed += 1;
      logWarning(context, 'driver.availability_monitor.failed', {
        driverIdHash: shortHash(document.id), reason: error?.code || 'unknown',
      });
    }
  }
  await cursorRef.set({ afterId: snap.size === SCAN_LIMIT ? snap.docs[snap.size - 1].id : null });
  logInfo(context, 'driver.availability_monitor.completed', summary);
  return summary;
}

const monitorDriverAvailabilityTask = onSchedule({
  region: 'southamerica-east1', schedule: 'every 1 minutes', timeZone: 'America/Fortaleza',
  retryCount: 0, maxInstances: 1, timeoutSeconds: 60,
}, () => {
  const nowMs = Date.now();
  return monitorDriverAvailability({ db: admin.firestore(), nowMs,
    context: { traceId: `availability-${nowMs}`, functionName: 'monitorDriverAvailabilityTask' } });
});

module.exports = {
  reconcileDriverAvailability, monitorDriverAvailability, monitorDriverAvailabilityTask,
  shouldSendAvailabilityAlert, SCAN_LIMIT, ALERT_TTL_MS,
};
