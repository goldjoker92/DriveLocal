// DEV-only Robot Driver engine.
//
// It never creates, accepts, starts or finishes a ride. The real passenger and
// driver screens keep controlling the complete business flow. This service only
// replaces the driver's physical GPS movement and publishes through the same
// session-bound Firestore documents consumed by dispatch and live tracking.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';
import {
  DRIVER_LOCATION_TASK,
  beginDevLocationSimulation,
  publishDevSimulatedLocation,
  restoreRealDriverTrackingAfterSimulation,
  stopDriverOnlineTracking,
} from './driverLocationTracking';
import {
  startDriverWorkSession,
  stopDriverWorkSession,
} from './driverAvailabilityService';
import { listenToMyOffer } from './ridesService';

const STORAGE_KEY = '@drivelocal/robot-driver-v1';
// Shared intentionally with driverLocationTracking. The simulator prepares the
// exact same local session before publishing its first point.
const TRACKING_SESSION_KEY = '@drivelocal/driver-location-session-v1';
const STEP_INTERVAL_MS = 3_000;
const WAITING_HEARTBEAT_MS = 4 * 60_000;
const ARRIVAL_THRESHOLD_METERS = 12;
const TERMINAL_RIDE_STATUSES = new Set(['completed', 'cancelled', 'disputed']);
const listeners = new Set();

const initialState = {
  enabled: false,
  phase: 'idle',
  driverId: null,
  availabilitySessionId: null,
  rideId: null,
  rideStatus: null,
  vehicleType: 'car',
  speedKmh: 20,
  currentPoint: null,
  targetPoint: null,
  targetKind: null,
  routeProgress: 0,
  lastPublishAtMs: null,
  lastEvent: 'robot.idle',
  errorCode: null,
};

let state = { ...initialState };
let movementTimer = null;
let heartbeatTimer = null;
let unsubscribeDriver = null;
let unsubscribeRide = null;
let currentRide = null;
let movementBusy = false;
let simulationId = null;
// Every ride binding owns one generation. Incrementing it invalidates callbacks
// and async continuations from the previous ride, even if Firestore had already
// queued a final snapshot before unsubscribe completed.
let rideBindingGeneration = 0;

function trace(event, details = {}, level = 'log') {
  const payload = {
    tag: 'ROBOT_DRIVER',
    event,
    simulationId,
    driverId: state.driverId,
    availabilitySessionId: state.availabilitySessionId,
    rideId: state.rideId,
    rideStatus: state.rideStatus,
    phase: state.phase,
    atMs: Date.now(),
    ...details,
  };
  const method = console[level] || console.log;
  method(`[ROBOT_DRIVER] ${event}`, payload);
}

function emit(patch, event = null) {
  state = { ...state, ...patch, ...(event ? { lastEvent: event } : {}) };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error) => {
    trace('state.persist_failed', { message: error?.message }, 'warn');
  });
  listeners.forEach((listener) => listener({ ...state }));
}

export function subscribeRobotDriver(listener) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export function getRobotDriverState() {
  return { ...state };
}

export function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const radius = 6_371_000;
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRad(Number(b.lat) - Number(a.lat));
  const dLng = toRad(Number(b.lng) - Number(a.lng));
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolateStep(from, to, meters) {
  const total = distanceMeters(from, to);
  if (!Number.isFinite(total) || total <= meters) return { ...to };
  const ratio = Math.max(0, Math.min(1, meters / total));
  return {
    lat: Number(from.lat) + (Number(to.lat) - Number(from.lat)) * ratio,
    lng: Number(from.lng) + (Number(to.lng) - Number(from.lng)) * ratio,
  };
}

function normalizePoint(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function ridePoint(kind) {
  const source = kind === 'pickup'
    ? (currentRide?.exactPickup || currentRide?.pickup)
    : (currentRide?.exactDestination || currentRide?.destination);
  return normalizePoint(source);
}

function offerRideStatus(offer) {
  if (offer?.driverRideStatus) return offer.driverRideStatus;
  if (offer?.exactDestination) return 'in_progress';
  return offer?.status === 'accepted' ? 'assigned' : null;
}

function movementAllowed(kind, rideStatus = state.rideStatus) {
  if (kind === 'pickup') return rideStatus === 'assigned';
  if (kind === 'destination') return rideStatus === 'in_progress';
  return false;
}

async function stopNativeTask() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
      trace('native_gps.stopped');
    }
  } catch (error) {
    trace('native_gps.stop_failed', { message: error?.message }, 'warn');
  }
}

async function writeTrackingSession(patch) {
  const raw = await AsyncStorage.getItem(TRACKING_SESSION_KEY);
  const current = raw ? JSON.parse(raw) : {};
  const next = {
    ...current,
    driverId: state.driverId,
    availabilitySessionId: state.availabilitySessionId,
    vehicleType: state.vehicleType,
    ...patch,
    updatedAtMs: Date.now(),
  };
  await AsyncStorage.setItem(TRACKING_SESSION_KEY, JSON.stringify(next));
  return next;
}

async function publishWaitingPoint(point, reason) {
  if (
    !state.enabled
    || !state.driverId
    || !state.availabilitySessionId
    || state.rideId
  ) return false;

  const nowMs = Date.now();
  await updateDoc(doc(db, 'drivers', state.driverId), {
    location: point,
    locationAccuracyMeters: 5,
    locationHeadingDegrees: null,
    locationSpeedMps: 0,
    locationUpdatedAtMs: nowMs,
    locationUpdatedAt: serverTimestamp(),
    locationAvailabilitySessionId: state.availabilitySessionId,
    availabilityUpdatedAtMs: nowMs,
    availabilityUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  emit({ currentPoint: point, lastPublishAtMs: nowMs }, 'robot.waiting_position_published');
  trace('location.published_waiting', { reason, point });
  return true;
}

async function publishRidePoint(point, reason) {
  const result = await publishDevSimulatedLocation({
    driverId: state.driverId,
    vehicleType: state.vehicleType,
    rideId: state.rideId,
    point,
  });
  if (result?.status !== 'published') {
    const error = new Error(result?.errorCode || 'ROBOT_PUBLISH_FAILED');
    error.code = result?.errorCode || 'ROBOT_PUBLISH_FAILED';
    throw error;
  }
  emit({ currentPoint: point, lastPublishAtMs: Date.now() }, 'robot.ride_position_published');
  trace('location.published_ride', { reason, point });
  return true;
}

async function publishPoint(point, reason) {
  return state.rideId
    ? publishRidePoint(point, reason)
    : publishWaitingPoint(point, reason);
}

function stopMovementTimer() {
  if (movementTimer) clearInterval(movementTimer);
  movementTimer = null;
}

async function movementTick() {
  if (movementBusy || state.phase !== 'moving' || !state.currentPoint || !state.targetPoint) return;
  if (!movementAllowed(state.targetKind)) {
    stopMovementTimer();
    emit({ phase: 'blocked_by_ride_status', errorCode: 'ROBOT_RIDE_STATUS_CHANGED' }, 'robot.movement_blocked');
    trace('movement.blocked_by_ride_status', { targetKind: state.targetKind }, 'warn');
    return;
  }

  movementBusy = true;
  try {
    const remaining = distanceMeters(state.currentPoint, state.targetPoint);
    const metersPerTick = Math.max(1, Number(state.speedKmh) / 3.6 * (STEP_INTERVAL_MS / 1000));
    trace('movement.tick', { remainingMeters: Math.round(remaining), metersPerTick });

    if (remaining <= ARRIVAL_THRESHOLD_METERS) {
      await publishPoint(state.targetPoint, 'target_arrived');
      stopMovementTimer();
      emit({ phase: 'arrived', routeProgress: 1 }, `robot.arrived_${state.targetKind}`);
      trace('movement.arrived', { targetKind: state.targetKind });
      return;
    }

    const next = interpolateStep(state.currentPoint, state.targetPoint, metersPerTick);
    await publishPoint(next, 'movement_tick');
    const remainingAfter = distanceMeters(next, state.targetPoint);
    const travelledThisTick = distanceMeters(state.currentPoint, next);
    const denominator = travelledThisTick + remainingAfter;
    emit({ routeProgress: denominator > 0 ? Math.max(0, Math.min(1, travelledThisTick / denominator)) : 0 });
  } catch (error) {
    stopMovementTimer();
    emit({ phase: 'failed', errorCode: error?.code || error?.message || 'ROBOT_TICK_FAILED' }, 'robot.failed');
    trace('movement.failed', { errorCode: error?.code, message: error?.message }, 'error');
  } finally {
    movementBusy = false;
  }
}

function bindingIsCurrent(rideId, generation) {
  return generation === rideBindingGeneration && state.rideId === rideId;
}

function closeRideListener() {
  if (unsubscribeRide) unsubscribeRide();
  unsubscribeRide = null;
}

async function returnRobotToWaiting(terminalRideId, terminalStatus, generation) {
  if (!bindingIsCurrent(terminalRideId, generation)) return;

  stopMovementTimer();
  closeRideListener();
  currentRide = null;
  rideBindingGeneration += 1;

  await writeTrackingSession({
    rideId: null,
    rideStatus: null,
    trackingPaused: false,
  }).catch((error) => {
    trace('tracking_session.update_failed', {
      terminalRideId,
      message: error?.message,
    }, 'warn');
  });

  emit({
    rideId: null,
    rideStatus: null,
    phase: 'waiting_request',
    targetPoint: null,
    targetKind: null,
    routeProgress: 0,
    errorCode: null,
  }, 'robot.ride_terminal');
  trace('ride.terminal', {
    terminalRideId,
    status: terminalStatus,
    result: 'waiting_for_next_request',
  });

  if (state.currentPoint) {
    publishWaitingPoint(state.currentPoint, 'ride_terminal')
      .catch((error) => trace('terminal_waiting_publish.failed', {
        terminalRideId,
        message: error?.message,
      }, 'warn'));
  }
}

function processRideOffer(nextOffer, rideId, generation) {
  if (!nextOffer || nextOffer.rideId !== rideId) return;
  if (!bindingIsCurrent(rideId, generation)) {
    trace('ride.snapshot_ignored', {
      snapshotRideId: nextOffer.rideId,
      bindingRideId: rideId,
      generation,
      currentGeneration: rideBindingGeneration,
      reason: 'stale_binding',
    });
    return;
  }

  currentRide = nextOffer;
  const nextStatus = offerRideStatus(nextOffer);
  trace('ride.snapshot', {
    source: 'driverOffers',
    exists: true,
    status: nextStatus,
    offerStatus: nextOffer.status,
    hasPickup: Boolean(ridePoint('pickup')),
    hasDestination: Boolean(ridePoint('destination')),
  });

  if (TERMINAL_RIDE_STATUSES.has(nextStatus)) {
    void returnRobotToWaiting(rideId, nextStatus, generation);
    return;
  }

  writeTrackingSession({ rideId, rideStatus: nextStatus || 'assigned', trackingPaused: false })
    .catch((error) => trace('tracking_session.update_failed', { message: error?.message }, 'warn'));

  if (state.phase === 'moving' && !movementAllowed(state.targetKind, nextStatus)) {
    stopMovementTimer();
    emit({ rideStatus: nextStatus, phase: 'blocked_by_ride_status', errorCode: 'ROBOT_RIDE_STATUS_CHANGED' }, 'robot.movement_blocked');
    trace('movement.blocked_by_ride_status', { targetKind: state.targetKind, nextStatus }, 'warn');
    return;
  }

  emit({
    rideStatus: nextStatus,
    phase: state.phase === 'terminal' ? 'ride_bound' : state.phase,
    errorCode: null,
  }, 'robot.ride_snapshot_received');
}

async function bindRide(rideId) {
  if (!rideId || rideId === state.rideId) return;

  const generation = ++rideBindingGeneration;
  const previousRideId = state.rideId;
  trace('ride.binding_started', { nextRideId: rideId, previousRideId, generation });

  // Invalidate the old ride before the first await. Firestore can still deliver a
  // callback that was already queued, but processRideOffer will reject its older
  // generation and it cannot mutate the new ride state.
  closeRideListener();
  stopMovementTimer();
  currentRide = null;
  emit({
    rideId,
    rideStatus: 'assigned',
    phase: 'ride_bound',
    targetPoint: null,
    targetKind: null,
    routeProgress: 0,
    errorCode: null,
  }, 'robot.ride_detected');

  await stopNativeTask();
  if (!bindingIsCurrent(rideId, generation)) return;

  await writeTrackingSession({
    rideId,
    rideStatus: 'assigned',
    trackingPaused: false,
  });
  if (!bindingIsCurrent(rideId, generation)) return;

  const simulation = await beginDevLocationSimulation({
    driverId: state.driverId,
    vehicleType: state.vehicleType,
    rideId,
  });
  if (!bindingIsCurrent(rideId, generation)) return;
  if (simulation?.status !== 'active') {
    const error = new Error(simulation?.errorCode || 'ROBOT_RIDE_OVERRIDE_FAILED');
    error.code = simulation?.errorCode || 'ROBOT_RIDE_OVERRIDE_FAILED';
    throw error;
  }

  await publishRidePoint(state.currentPoint, 'ride_bound_seed');
  if (!bindingIsCurrent(rideId, generation)) return;

  unsubscribeRide = listenToMyOffer(
    state.driverId,
    (nextOffer) => processRideOffer(nextOffer, rideId, generation),
    (error) => {
      if (!bindingIsCurrent(rideId, generation)) return;
      trace('ride.listener_failed', {
        source: 'driverOffers',
        code: error?.code,
        message: error?.message,
      }, 'error');
      emit({ errorCode: error?.code || 'ROBOT_RIDE_LISTENER_FAILED' }, 'robot.ride_listener_failed');
    },
    rideId
  );
  trace('ride.binding_succeeded', { rideId, source: 'driverOffers', generation });
}

function startDriverListener() {
  if (unsubscribeDriver) unsubscribeDriver();
  unsubscribeDriver = onSnapshot(doc(db, 'drivers', state.driverId), (snapshot) => {
    const driver = snapshot.exists() ? snapshot.data() : null;
    const activeRideId = driver?.activeRideId || null;
    trace('driver.snapshot', {
      exists: Boolean(driver),
      availabilityStatus: driver?.availabilityStatus,
      availabilitySessionMatches: driver?.availabilitySessionId === state.availabilitySessionId,
      activeRideId,
      vehicleType: driver?.vehicleType,
    });
    if (activeRideId && activeRideId !== state.rideId) {
      bindRide(activeRideId).catch((error) => {
        emit({ phase: 'failed', errorCode: error?.code || error?.message || 'ROBOT_BIND_RIDE_FAILED' }, 'robot.failed');
        trace('ride.binding_failed', { code: error?.code, message: error?.message }, 'error');
      });
    }
  }, (error) => {
    trace('driver.listener_failed', { code: error?.code, message: error?.message }, 'error');
  });
}

export function presetPoint(origin, distanceKm) {
  const point = normalizePoint(origin);
  if (!point) return null;
  const meters = Number(distanceKm) * 1000;
  const north = meters * 0.82;
  const east = meters * 0.57;
  return {
    lat: point.lat + north / 111_320,
    lng: point.lng + east / (111_320 * Math.cos((point.lat * Math.PI) / 180)),
  };
}

export async function resolveRobotStartPoint({ presetKm, address }) {
  if (address?.trim()) {
    trace('start.geocode_started', { addressLength: address.trim().length });
    const results = await Location.geocodeAsync(address.trim());
    const first = results?.[0];
    const point = normalizePoint(first);
    if (!point) throw new Error('ROBOT_ADDRESS_NOT_FOUND');
    trace('start.geocode_succeeded', { point });
    return point;
  }

  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const origin = normalizePoint(current?.coords);
  const point = presetPoint(origin, Number(presetKm || 1));
  if (!point) throw new Error('ROBOT_START_POSITION_UNAVAILABLE');
  trace('start.preset_resolved', { presetKm, origin, point });
  return point;
}

export async function activateRobotDriver({ vehicleType, speedKmh, startPoint }) {
  if (!DEV_RIDE_SIMULATOR_ENABLED) throw new Error('DEV_SIMULATOR_DISABLED');
  const driverId = auth.currentUser?.uid;
  const point = normalizePoint(startPoint);
  if (!driverId || !point) throw new Error('ROBOT_INVALID_ACTIVATION');

  let workSession = null;
  simulationId = `robot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  rideBindingGeneration += 1;
  closeRideListener();
  stopMovementTimer();
  currentRide = null;
  try {
    workSession = await startDriverWorkSession();
    state = {
      ...initialState,
      enabled: true,
      phase: 'waiting_request',
      driverId,
      availabilitySessionId: workSession.availabilitySessionId,
      vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
      speedKmh: Number(speedKmh) || 20,
      currentPoint: point,
      lastEvent: 'robot.activation_started',
    };
    trace('activation.started', { startPoint: point, speedKmh: state.speedKmh, vehicleType: state.vehicleType });
    await stopNativeTask();
    await writeTrackingSession({ rideId: null, rideStatus: null, trackingPaused: false });
    await publishWaitingPoint(point, 'activation');
    startDriverListener();

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      stopNativeTask()
        .then(() => publishWaitingPoint(state.currentPoint, 'waiting_heartbeat'))
        .catch((error) => {
          trace('waiting_heartbeat.failed', { message: error?.message }, 'error');
        });
    }, WAITING_HEARTBEAT_MS);

    emit({ phase: 'waiting_request' }, 'robot.active_waiting_request');
    trace('activation.succeeded');
    return getRobotDriverState();
  } catch (error) {
    await stopDriverOnlineTracking().catch(() => undefined);
    if (workSession?.availabilitySessionId) {
      await stopDriverWorkSession(workSession.availabilitySessionId).catch(() => undefined);
    }
    state = { ...initialState, lastEvent: 'robot.activation_failed', errorCode: error?.code || error?.message };
    trace('activation.failed', { code: error?.code, message: error?.message }, 'error');
    throw error;
  }
}

export async function moveRobotTo(kind) {
  if (!state.enabled) throw new Error('ROBOT_NOT_ACTIVE');
  if (!state.rideId || !currentRide) throw new Error('ROBOT_RIDE_NOT_READY');
  if (kind !== 'pickup' && kind !== 'destination') throw new Error('ROBOT_INVALID_TARGET');
  if (!movementAllowed(kind)) {
    const error = new Error(kind === 'pickup'
      ? 'ROBOT_PICKUP_REQUIRES_ASSIGNED_RIDE'
      : 'ROBOT_DESTINATION_REQUIRES_IN_PROGRESS_RIDE');
    error.code = error.message;
    trace('movement.rejected_by_ride_status', { targetKind: kind }, 'warn');
    throw error;
  }
  const target = ridePoint(kind);
  if (!target) throw new Error(`ROBOT_${kind.toUpperCase()}_MISSING`);

  stopMovementTimer();
  emit({ phase: 'moving', targetPoint: target, targetKind: kind, routeProgress: 0, errorCode: null }, `robot.moving_${kind}`);
  trace('movement.started', { targetKind: kind, target, speedKmh: state.speedKmh });
  await movementTick();
  if (state.phase === 'moving') movementTimer = setInterval(movementTick, STEP_INTERVAL_MS);
}

export function pauseRobotDriver() {
  if (state.phase !== 'moving') return;
  stopMovementTimer();
  emit({ phase: 'paused' }, 'robot.paused');
  trace('movement.paused');
}

export function resumeRobotDriver() {
  if (state.phase !== 'paused' || !state.targetPoint) return;
  if (!movementAllowed(state.targetKind)) {
    emit({ phase: 'blocked_by_ride_status', errorCode: 'ROBOT_RIDE_STATUS_CHANGED' }, 'robot.resume_blocked');
    trace('movement.resume_blocked_by_ride_status', { targetKind: state.targetKind }, 'warn');
    return;
  }
  emit({ phase: 'moving', errorCode: null }, 'robot.resumed');
  trace('movement.resumed');
  movementTimer = setInterval(movementTick, STEP_INTERVAL_MS);
}

export async function stopRobotDriver(options = {}) {
  const restoreRealTracking = options.restoreRealTracking !== false;
  trace('stop.started', { restoreRealTracking });
  rideBindingGeneration += 1;
  stopMovementTimer();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (unsubscribeDriver) unsubscribeDriver();
  closeRideListener();
  unsubscribeDriver = null;
  currentRide = null;

  try {
    if (restoreRealTracking) {
      await restoreRealDriverTrackingAfterSimulation();
    } else {
      await stopDriverOnlineTracking();
    }
  } catch (error) {
    trace('stop.tracking_cleanup_failed', { message: error?.message }, 'warn');
  }
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  state = { ...initialState, lastEvent: 'robot.stopped' };
  listeners.forEach((listener) => listener({ ...state }));
  trace('stop.succeeded');
  simulationId = null;
}
