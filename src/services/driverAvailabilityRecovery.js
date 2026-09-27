import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { getDriverTrackingSession, refreshDriverOnlineHeartbeat } from './driverLocationTracking';
import { getDriverDeviceDiagnostic } from './driverDeviceDiagnostics';
import { publishDriverDeviceHealth } from './driverDeviceHealthStore';
import { evaluateDriverDispatchReadiness } from '../../functions/src/drivers/dispatchReadiness';
import { remoteWorkSessionRecoverable } from '../utils/driverWorkSession';

function recoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const pendingByAccount = new Map();

// A UI timeout does not cancel a native GPS request or a Firestore read. Share
// the pending attempt so another tap cannot start a second recovery behind it.
export function recoverDriverAvailability(driverBuildPolicy = {}) {
  const uid = auth.currentUser?.uid || null;
  if (pendingByAccount.has(uid)) return pendingByAccount.get(uid);
  const startedAt = Date.now();
  const traceId = `availability_recovery_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
  const trace = (event, extra = {}) => console.info(`[DRIVER_AVAILABILITY] ${event}`, {
    scope: 'driver_availability', event, traceId, atMs: Date.now(),
    durationMs: Math.max(0, Date.now() - startedAt), ...extra,
  });
  trace('recovery.started');
  const pending = recoverCurrentSession(uid, driverBuildPolicy)
    .then((result) => {
      trace('recovery.succeeded', { result: result.status });
      return result;
    })
    .catch((error) => {
      // Stable SDK/business codes only; never log the raw message or profile.
      trace('recovery.failed', { reason: error?.code || 'RECOVERY_FAILED' });
      throw error;
    })
    .finally(() => { if (pendingByAccount.get(uid) === pending) pendingByAccount.delete(uid); });
  pendingByAccount.set(uid, pending);
  return pending;
}

async function recoverCurrentSession(uid, driverBuildPolicy) {
  const local = await getDriverTrackingSession();
  if (!uid || local?.driverId !== uid || !local.availabilitySessionId) {
    throw recoveryError('SESSION_RESTART_REQUIRED', 'Volte ao início e comece a trabalhar novamente.');
  }
  if (local.rideId) return { status: 'active_ride' };
  const ref = doc(db, 'drivers', uid);
  const initialSnapshot = await getDocFromServer(ref);
  const initial = initialSnapshot.exists() ? initialSnapshot.data() : null;
  if (initial?.activeRideId) return { status: 'active_ride' };
  if (initial?.availabilityStatus !== 'online'
    || initial.availabilitySessionId !== local.availabilitySessionId
    || !remoteWorkSessionRecoverable(initial)) {
    throw recoveryError('SESSION_RESTART_REQUIRED', 'Sua sessão mudou. Volte ao início para começar novamente.');
  }

  if (auth.currentUser?.uid !== uid) {
    throw recoveryError('SESSION_CHANGED', 'Sua sessão mudou durante a verificação. Confira sua situação no início.');
  }
  const result = await refreshDriverOnlineHeartbeat({ force: true });
  if (result?.status !== 'published') {
    throw recoveryError('LOCATION_NOT_CONFIRMED', 'Ainda não confirmamos uma nova posição. Verifique o GPS, as permissões e a internet.');
  }
  // Success means a durable server point on the SAME session, never just a
  // queued offline write or a successful independent heartbeat.
  const snapshot = await getDocFromServer(ref);
  const driver = snapshot.exists() ? snapshot.data() : null;
  const currentLocal = await getDriverTrackingSession();
  if (auth.currentUser?.uid !== uid
    || currentLocal?.availabilitySessionId !== local.availabilitySessionId
    || driver?.availabilitySessionId !== local.availabilitySessionId) {
    throw recoveryError('SESSION_CHANGED', 'Sua sessão mudou durante a verificação. Confira sua situação no início.');
  }
  if (driver?.activeRideId || currentLocal?.rideId) return { status: 'active_ride' };
  const readiness = evaluateDriverDispatchReadiness(driver, { driverBuildPolicy });
  if (!readiness.ready || readiness.delayed) {
    throw recoveryError('AVAILABILITY_NOT_CONFIRMED', 'Sua disponibilidade ainda não foi confirmada. Confira o aviso e tente novamente.');
  }
  const diagnostic = await getDriverDeviceDiagnostic({ expectTrackingActive: true });
  if (auth.currentUser?.uid !== uid) {
    throw recoveryError('SESSION_CHANGED', 'Sua sessão mudou durante a verificação. Confira sua situação no início.');
  }
  publishDriverDeviceHealth(uid, diagnostic, local.availabilitySessionId);
  if (diagnostic.blocking || diagnostic.primaryIssue?.code === 'diagnostic_failed') {
    throw recoveryError('DEVICE_NOT_READY', diagnostic.primaryIssue?.message || 'Confira as permissões do aparelho.');
  }
  return { status: 'ready' };
}
