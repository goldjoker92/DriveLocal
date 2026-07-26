// Driver work-session client. Availability is server-authoritative: the app asks
// to start/stop working and receives the session id that every GPS point must use.
// Device readiness is validated before the server session is opened so the
// cockpit can never turn green without GPS and notifications actually working.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { prepareDriverDeviceForAvailability } from './driverDeviceDiagnostics';

const setDriverAvailabilitySecure = httpsCallable(functions, 'setDriverAvailabilitySecure');

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function traceAvailability(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[DRIVER_AVAILABILITY] ${event}`, {
    scope: 'driver_availability',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function normalizedResult(response) {
  const data = response?.data || {};
  return {
    driverId: data.driverId || null,
    availabilityStatus: data.availabilityStatus === 'online' ? 'online' : 'offline',
    availabilitySessionId: data.availabilitySessionId || null,
    availabilityUpdatedAtMs: Number(data.availabilityUpdatedAtMs || 0) || null,
    activeRideId: data.activeRideId || null,
    replay: data.replay === true,
  };
}

function deviceNotReadyError(diagnostic) {
  const error = new Error('DRIVER_DEVICE_NOT_READY');
  error.code = 'DRIVER_DEVICE_NOT_READY';
  error.details = {
    message: diagnostic?.primaryIssue?.message
      || 'Verifique o GPS e as notificações antes de começar a trabalhar.',
    issueCode: diagnostic?.primaryIssue?.code || 'unknown',
    retryable: diagnostic?.primaryIssue?.action !== 'settings',
  };
  return error;
}

export async function startDriverWorkSession() {
  const startedAt = Date.now();
  traceAvailability('work_session.start_requested', { desiredStatus: 'online' });
  try {
    const diagnostic = await prepareDriverDeviceForAvailability();
    if (!diagnostic.readyForAvailability) {
      traceAvailability('work_session.start_rejected', {
        reason: 'device_not_ready',
        issueCode: diagnostic.primaryIssue?.code || 'unknown',
        result: 'offline',
      }, 'warn');
      throw deviceNotReadyError(diagnostic);
    }

    traceAvailability('work_session.device_ready', {
      devSimulationBypass: diagnostic.devSimulationBypass === true,
      result: 'preflight_passed',
    });

    const response = await setDriverAvailabilitySecure({ availabilityStatus: 'online' });
    const result = normalizedResult(response);
    if (result.availabilityStatus !== 'online' || !result.availabilitySessionId) {
      const error = new Error('DRIVER_WORK_SESSION_NOT_OPENED');
      error.code = 'DRIVER_WORK_SESSION_NOT_OPENED';
      throw error;
    }
    traceAvailability('work_session.start_succeeded', {
      driverId: shortId(result.driverId),
      availabilitySessionId: shortId(result.availabilitySessionId),
      replay: result.replay,
      durationMs: Date.now() - startedAt,
      result: 'online',
    });
    return result;
  } catch (error) {
    traceAvailability('work_session.start_failed', {
      reason: error?.code || error?.message || 'unknown',
      issueCode: error?.details?.issueCode || null,
      durationMs: Date.now() - startedAt,
      result: 'offline',
    }, 'warn');
    throw error;
  }
}

export async function stopDriverWorkSession(availabilitySessionId = null) {
  const startedAt = Date.now();
  const payload = { availabilityStatus: 'offline' };
  if (availabilitySessionId) payload.availabilitySessionId = availabilitySessionId;
  traceAvailability('work_session.stop_requested', {
    availabilitySessionId: shortId(availabilitySessionId),
    desiredStatus: 'offline',
  });
  try {
    const response = await setDriverAvailabilitySecure(payload);
    const result = normalizedResult(response);
    traceAvailability('work_session.stop_succeeded', {
      driverId: shortId(result.driverId),
      previousSessionId: shortId(availabilitySessionId),
      replay: result.replay,
      durationMs: Date.now() - startedAt,
      result: result.availabilityStatus,
    });
    return result;
  } catch (error) {
    traceAvailability('work_session.stop_failed', {
      availabilitySessionId: shortId(availabilitySessionId),
      reason: error?.code || error?.message || 'unknown',
      durationMs: Date.now() - startedAt,
      result: 'remote_state_unknown',
    }, 'warn');
    throw error;
  }
}
