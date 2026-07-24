// DEV-only Robot Driver engine.
//
// It never creates, accepts, starts or finishes a ride. The real passenger and
// driver screens keep controlling the complete business flow. This service only
// replaces the driver's physical GPS movement and publishes through the same
// Firestore documents consumed by dispatch and live tracking.

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
} from './driverLocationTracking';
import { listenToMyOffer } from './ridesService';

const STORAGE_KEY = '@drivelocal/robot-driver-v1';
// Shared intentionally with driverLocationTracking. Writing the ride session
// before enabling its DEV override avoids one native-GPS publication during the
// online -> accepted-ride transition.
const TRACKING_SESSION_KEY = '@drivelocal/driver-location-session-v1';
const STEP_INTERVAL_MS = 3_000;
const WAITING_HEARTBEAT_MS = 30_000;
const ARRIVAL_THRESHOLD_METERS = 12;
const TERMINAL_RIDE_STATUSES = new Set(['completed', 'cancelled', 'disputed']);
const listeners = new Set();

const initialState = {
  enabled: false,
  phase: 'idle',
  driverId: null,
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

function trace(event, details = {}, level = 'log') {
  const payload = {
    tag: 'ROBOT_DRIVER',
    event,
    simulationId,
    driverId: state.driverId,
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
  // The accepted offer reveals the exact destination only after the real ride is
  // started. Keep this fallback aligned with the existing active-ride screen.
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

async function publishWaitingPoint(point, reason) {
  if (!state.enabled || !state.driverId || state.rideId) return false;
  await updateDoc(doc(db, 'drivers', state.driverId), {
    location: point,
    locationAccuracyMeters: 5,
    locationHeadingDegrees: null,
    locationSpeedMps: 0,
    locationUpdatedAtMs: Date.now(),
    locationUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  emit({ currentPoint: point, lastPublishAtMs: Date.now() }, 'robot.waiting_position_published');
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

function processRideOffer(nextOffer, rideId) {
  if (!nextOffer || nextOffer.rideId !== rideId) return;
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
    stopMovementTimer();
    emit({ rideStatus: nextStatus, phase: 'terminal', targetPoint: null, targetKind: null }, 'robot.ride_terminal');
    trace('ride.terminal', { status: nextStatus });
    return;
  }

  if (state.phase === 'moving' && !movementAllowed(state.targetKind, nextStatus)) {
    stopMovementTimer();
    emit({ rideStatus: nextStatus, phase: 'blocked_by_ride_status', errorCode: 'ROBOT_RIDE_STATUS_CHANGED' }, 'robot.movement_blocked');
    trace('movement.blocked_by_ride_status', { targetKind: state.targetKind, nextStatus }, 'warn');
    return;
  }

  emit({ rideStatus: nextStatus, errorCode: null }, 'robot.ride_snapshot_received');
}

async function bindRide(rideId) {
  if (!rideId || rideId === state.rideId) return;
  trace('ride.binding_started', { nextRideId: rideId });
  emit({ rideId, rideStatus: null, phase: 'ride_bound' }, 'robot.ride_detected');

  // Avoid the legacy native tracking helper here because it starts native GPS
  // before the DEV override exists. Preparing the same secured local session
  // first keeps simulated GPS authoritative with zero real-GPS flash.
  await stopNativeTask();
  await AsyncStorage.setItem(TRACKING_SESSION_KEY, JSON.stringify({
    driverId: state.driverId,
    vehicleType: state.vehicleType,
    rideId,
    updatedAtMs: Date.now(),
  }));
  const simulation = await beginDevLocationSimulation({
    driverId: state.driverId,
    vehicleType: state.vehicleType,
    rideId,
  });
  if (simulation?.status !== 'active') {
    const error = new Error(simulation?.errorCode || 'ROBOT_RIDE_OVERRIDE_FAILED');
    error.code = simulation?.errorCode || 'ROBOT_RIDE_OVERRIDE_FAILED';
    throw error;
  }

  // Seed activeRideLocations immediately so both real screens have a point as
  // soon as the accepted ride opens, before the operator presses Move.
  await publishRidePoint(state.currentPoint, 'ride_bound_seed');

  if (unsubscribeRide) unsubscribeRide();
  // Drivers are intentionally forbidden from reading rideRequests directly.
  // The secured winning offer is their source of truth for lifecycle status and
  // reveals exact pickup/destination coordinates at the correct moments.
  unsubscribeRide = listenToMyOffer(
    state.driverId,
    (nextOffer) => processRideOffer(nextOffer, rideId),
    (error) => {
      trace('ride.listener_failed', {
        source: 'driverOffers',
        code: error?.code,
        message: error?.message,
      }, 'error');
      emit({ errorCode: error?.code || 'ROBOT_RIDE_LISTENER_FAILED' }, 'robot.ride_listener_failed');
    },
    rideId
  );
  trace('ride.binding_succeeded', { rideId, source: 'driverOffers' });
}

function startDriverListener() {
  if (unsubscribeDriver) unsubscribeDriver();
  unsubscribeDriver = onSnapshot(doc(db, 'drivers', state.driverId), (snapshot) => {
    const driver = snapshot.exists() ? snapshot.data() : null;
    const activeRideId = driver?.activeRideId || null;
    trace('driver.snapshot', {
      exists: Boolean(driver),
      availabilityStatus: driver?.availabilityStatus,
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
  // Offset north-east so several presets remain visible and deterministic.
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

  simulationId = `robot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state = {
    ...initialState,
    enabled: true,
    phase: 'waiting_request',
    driverId,
    vehicleType: vehicleType === 'moto' ? 'moto' : 'car',
    speedKmh: Number(speedKmh) || 20,
    currentPoint: point,
    lastEvent: 'robot.activation_started',
  };
  trace('activation.started', { startPoint: point, speedKmh: state.speedKmh, vehicleType: state.vehicleType });
  await stopNativeTask();
  await publishWaitingPoint(point, 'activation');
  startDriverListener();

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    // The online screen is also guarded, but this watchdog repairs any external
    // native-task restart and republishes the authoritative simulated point.
    stopNativeTask()
      .then(() => publishWaitingPoint(state.currentPoint, 'waiting_heartbeat'))
      .catch((error) => {
        trace('waiting_heartbeat.failed', { message: error?.message }, 'error');
      });
  }, WAITING_HEARTBEAT_MS);

  emit({ phase: 'waiting_request' }, 'robot.active_waiting_request');
  trace('activation.succeeded');
  return getRobotDriverState();
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

export async function stopRobotDriver() {
  trace('stop.started');
  stopMovementTimer();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (unsubscribeDriver) unsubscribeDriver();
  if (unsubscribeRide) unsubscribeRide();
  unsubscribeDriver = null;
  unsubscribeRide = null;
  currentRide = null;

  try {
    await restoreRealDriverTrackingAfterSimulation();
  } catch (error) {
    trace('stop.restore_native_failed', { message: error?.message }, 'warn');
  }
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  state = { ...initialState, lastEvent: 'robot.stopped' };
  listeners.forEach((listener) => listener({ ...state }));
  trace('stop.succeeded');
  simulationId = null;
}
