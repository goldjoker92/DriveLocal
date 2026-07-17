import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';
import {
  beginDevLocationSimulation,
  publishDevSimulatedLocation,
  restoreRealDriverTrackingAfterSimulation,
} from './driverLocationTracking';
import {
  buildDevSimulationRoute,
  createFallbackSimulationStart,
  DEV_SIMULATION_DEFAULT_STEPS,
  DEV_SIMULATION_INTERVAL_MS,
} from '../utils/devRideSimulation';
import { normalizeTrackingPoint } from '../utils/rideTracking';
import { createDevTraceId, logDevTrace } from '../utils/devTrace';

const DIAGNOSTIC_STATE_KEY = '@drivelocal/dev-ride-simulation-state-v1';

let runtime = null;
let currentState = null;
const listeners = new Set();

function disabledResult() {
  return { status: 'disabled', errorCode: 'DEV_SIMULATOR_DISABLED' };
}

function publicState(state) {
  if (!state) return null;
  return {
    rideId: state.rideId,
    traceId: state.traceId,
    status: state.status,
    mode: state.mode,
    stepIndex: state.stepIndex,
    stepCount: state.stepCount,
    errorCode: state.errorCode || null,
    updatedAtMs: state.updatedAtMs,
  };
}

async function persistDiagnosticState(state) {
  try {
    // Only summary metadata is persisted. Synthetic coordinates and the route
    // stay in memory and disappear when the process stops.
    await AsyncStorage.setItem(DIAGNOSTIC_STATE_KEY, JSON.stringify(publicState(state)));
  } catch (_error) {
    // A diagnostic write must never interrupt a ride or location publishing.
  }
}

function emit(next) {
  currentState = next ? { ...next, updatedAtMs: Date.now() } : null;
  void persistDiagnosticState(currentState);
  listeners.forEach((listener) => listener(publicState(currentState)));
}

function clearTimer() {
  if (runtime?.timer) clearInterval(runtime.timer);
  if (runtime) runtime.timer = null;
}

function failState(errorCode) {
  clearTimer();
  if (!currentState) return;
  emit({ ...currentState, status: 'error', errorCode });
  logDevTrace('simulation_failed', {
    traceId: currentState.traceId,
    status: 'error',
    mode: currentState.mode,
    stepIndex: currentState.stepIndex,
    stepCount: currentState.stepCount,
    errorCode,
  }, 'error');
}

async function resolveStartPoint(rideId, target, fallbackDirection) {
  try {
    const snapshot = await getDoc(doc(db, 'activeRideLocations', rideId));
    const livePoint = normalizeTrackingPoint(snapshot.exists() ? snapshot.data()?.location : null);
    if (livePoint) return livePoint;
  } catch (_error) {
    // The fallback below keeps the DEV tool usable if the first live point has
    // not reached Firestore yet. Security Rules still protect every later write.
  }
  return createFallbackSimulationStart(target, fallbackDirection);
}

async function publishStep(index) {
  if (!runtime || currentState?.status !== 'running' || runtime.inFlight) return;
  const point = runtime.route[index];
  if (!point) return;

  runtime.inFlight = true;
  const startedAt = Date.now();
  try {
    const result = await publishDevSimulatedLocation({
      driverId: runtime.driverId,
      vehicleType: runtime.vehicleType,
      rideId: runtime.rideId,
      point,
    });
    if (result.status !== 'published') {
      failState(result.errorCode || 'DEV_LOCATION_PUBLISH_FAILED');
      return;
    }

    const finished = index >= currentState.stepCount;
    emit({
      ...currentState,
      status: finished ? 'completed' : 'running',
      stepIndex: index,
      errorCode: null,
    });
    logDevTrace(finished ? 'simulation_route_completed' : 'simulation_step_published', {
      traceId: currentState.traceId,
      status: finished ? 'completed' : 'running',
      mode: currentState.mode,
      stepIndex: index,
      stepCount: currentState.stepCount,
      durationMs: Date.now() - startedAt,
    });

    if (finished) clearTimer();
  } catch (_error) {
    failState('DEV_LOCATION_PUBLISH_EXCEPTION');
  } finally {
    if (runtime) runtime.inFlight = false;
  }
}

function scheduleRemainingSteps() {
  clearTimer();
  if (!runtime || currentState?.status !== 'running') return;
  runtime.timer = setInterval(() => {
    const nextIndex = Number(currentState?.stepIndex || 0) + 1;
    void publishStep(nextIndex);
  }, DEV_SIMULATION_INTERVAL_MS);
}

export function subscribeDevRideSimulation(listener) {
  if (!DEV_RIDE_SIMULATOR_ENABLED || typeof listener !== 'function') return () => {};
  listeners.add(listener);
  if (currentState) listener(publicState(currentState));
  return () => listeners.delete(listener);
}

export async function getDevRideSimulationState() {
  if (!DEV_RIDE_SIMULATOR_ENABLED) return disabledResult();
  if (currentState) return publicState(currentState);

  try {
    const raw = await AsyncStorage.getItem(DIAGNOSTIC_STATE_KEY);
    if (!raw) return { status: 'idle' };
    const stored = JSON.parse(raw);
    const interrupted = ['running', 'paused'].includes(stored?.status)
      ? { ...stored, status: 'interrupted', errorCode: 'DEV_SIMULATION_PROCESS_RESTARTED' }
      : stored;
    currentState = interrupted;
    return publicState(interrupted);
  } catch (_error) {
    return { status: 'idle' };
  }
}

export async function startDevRideSimulation({
  driverId,
  vehicleType,
  rideId,
  target,
  mode,
  steps = DEV_SIMULATION_DEFAULT_STEPS,
}) {
  if (!DEV_RIDE_SIMULATOR_ENABLED) return disabledResult();
  if (!driverId || !rideId || !normalizeTrackingPoint(target)) {
    return { status: 'error', errorCode: 'DEV_SIMULATION_INVALID_INPUT' };
  }

  clearTimer();
  runtime = null;

  const nativeOverride = await beginDevLocationSimulation({ driverId, vehicleType, rideId });
  if (nativeOverride.status !== 'active') {
    return {
      status: 'error',
      errorCode: nativeOverride.errorCode || 'DEV_SIMULATION_SESSION_UNAVAILABLE',
    };
  }

  const normalizedTarget = normalizeTrackingPoint(target);
  const fallbackDirection = mode === 'to_destination' ? -1 : 1;
  const start = await resolveStartPoint(rideId, normalizedTarget, fallbackDirection);
  const route = buildDevSimulationRoute(start, normalizedTarget, steps);
  if (route.length < 2) {
    await restoreRealDriverTrackingAfterSimulation();
    return { status: 'error', errorCode: 'DEV_SIMULATION_ROUTE_INVALID' };
  }

  const traceId = createDevTraceId();
  runtime = {
    driverId,
    vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
    rideId,
    route,
    timer: null,
    inFlight: false,
  };
  emit({
    rideId,
    traceId,
    status: 'running',
    mode: mode === 'to_destination' ? 'to_destination' : 'to_pickup',
    stepIndex: 0,
    stepCount: route.length - 1,
    errorCode: null,
  });
  logDevTrace('simulation_started', {
    traceId,
    status: 'running',
    mode: currentState.mode,
    stepIndex: 0,
    stepCount: currentState.stepCount,
  });

  await publishStep(0);
  if (currentState?.status === 'running') scheduleRemainingSteps();
  return publicState(currentState);
}

export function pauseDevRideSimulation() {
  if (!DEV_RIDE_SIMULATOR_ENABLED) return disabledResult();
  if (!runtime || currentState?.status !== 'running') return publicState(currentState) || { status: 'idle' };
  clearTimer();
  emit({ ...currentState, status: 'paused' });
  logDevTrace('simulation_paused', {
    traceId: currentState.traceId,
    status: 'paused',
    mode: currentState.mode,
    stepIndex: currentState.stepIndex,
    stepCount: currentState.stepCount,
  });
  return publicState(currentState);
}

export function resumeDevRideSimulation() {
  if (!DEV_RIDE_SIMULATOR_ENABLED) return disabledResult();
  if (!runtime || currentState?.status !== 'paused') return publicState(currentState) || { status: 'idle' };
  emit({ ...currentState, status: 'running' });
  logDevTrace('simulation_resumed', {
    traceId: currentState.traceId,
    status: 'running',
    mode: currentState.mode,
    stepIndex: currentState.stepIndex,
    stepCount: currentState.stepCount,
  });
  scheduleRemainingSteps();
  return publicState(currentState);
}

export async function stopDevRideSimulation({ restoreRealTracking = true } = {}) {
  if (!DEV_RIDE_SIMULATOR_ENABLED) return disabledResult();
  clearTimer();
  runtime = null;

  if (currentState) {
    emit({ ...currentState, status: 'stopped' });
    logDevTrace('simulation_stopped', {
      traceId: currentState.traceId,
      status: 'stopped',
      mode: currentState.mode,
      stepIndex: currentState.stepIndex,
      stepCount: currentState.stepCount,
    });
  }

  if (restoreRealTracking) {
    const restored = await restoreRealDriverTrackingAfterSimulation();
    if (restored.status !== 'active') return restored;
  }
  return publicState(currentState) || { status: 'stopped' };
}
