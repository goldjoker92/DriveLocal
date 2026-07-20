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
  attachActiveRideTracking,
  beginDevLocationSimulation,
  publishDevSimulatedLocation,
  restoreRealDriverTrackingAfterSimulation,
} from './driverLocationTracking';

const STORAGE_KEY = '@drivelocal/robot-driver-v1';
const STEP_INTERVAL_MS = 3_000;
const WAITING_HEARTBEAT_MS = 30_000;
const ARRIVAL_THRESHOLD_METERS = 12;
const listeners = new Set();

const initialState = {
  enabled: false,
  phase: 'idle',
  driverId: null,
  rideId: null,
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
  const source = kind === 'pickup' ? currentRide?.pickup : currentRide?.destination;
  return normalizePoint(source);
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
    const total = distanceMeters(state.currentPoint, state.targetPoint) + remaining;
    emit({ routeProgress: total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0 });
  } catch (error) {
    stopMovementTimer();
    emit({ phase: 'failed', errorCode: error?.code || error?.message || 'ROBOT_TICK_FAILED' }, 'robot.failed');
    trace('movement.failed', { errorCode: error?.code, message: error?.message }, 'error');
  } finally {
    movementBusy = false;
  }
}

async function bindRide(rideId) {
  if (!rideId || rideId === state.rideId) return;
  trace('ride.binding_started', { nextRideId: rideId });
  emit({ rideId, phase: 'ride_bound' }, 'robot.ride_detected');

  await attachActiveRideTracking({
    driverId: state.driverId,
    vehicleType: state.vehicleType,
    rideId,
    requestPermissions: false,
  });
  const simulation = await beginDevLocationSimulation({
    driverId: state.driverId,
    vehicleType: state.vehicleType,
    rideId,
  });
  if (simulation?.status !== 'active') {
    throw new Error(simulation?.errorCode || 'ROBOT_RIDE_OVERRIDE_FAILED');
  }

  if (unsubscribeRide) unsubscribeRide();
  unsubscribeRide = onSnapshot(doc(db, 'rideRequests', rideId), (snapshot) => {
    currentRide = snapshot.exists() ? { rideId: snapshot.id, ...snapshot.data() } : null;
    trace('ride.snapshot', {
      exists: Boolean(currentRide),
      status: currentRide?.status,
      hasPickup: Boolean(ridePoint('pickup')),
      hasDestination: Boolean(ridePoint('destination')),
    });
    emit({}, 'robot.ride_snapshot_received');
  }, (error) => {
    trace('ride.listener_failed', { code: error?.code, message: error?.message }, 'error');
    emit({ errorCode: error?.code || 'ROBOT_RIDE_LISTENER_FAILED' }, 'robot.ride_listener_failed');
  });
  trace('ride.binding_succeeded', { rideId });
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
        emit({ phase: 'failed', errorCode: error?.message || 'ROBOT_BIND_RIDE_FAILED' }, 'robot.failed');
        trace('ride.binding_failed', { message: error?.message }, 'error');
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
    publishWaitingPoint(state.currentPoint, 'waiting_heartbeat').catch((error) => {
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
  const target = ridePoint(kind);
  if (!target) throw new Error(`ROBOT_${kind.toUpperCase()}_MISSING`);

  stopMovementTimer();
  emit({ phase: 'moving', targetPoint: target, targetKind: kind, routeProgress: 0, errorCode: null }, `robot.moving_${kind}`);
  trace('movement.started', { targetKind: kind, target, speedKmh: state.speedKmh });
  await movementTick();
  movementTimer = setInterval(movementTick, STEP_INTERVAL_MS);
}

export function pauseRobotDriver() {
  if (state.phase !== 'moving') return;
  stopMovementTimer();
  emit({ phase: 'paused' }, 'robot.paused');
  trace('movement.paused');
}

export function resumeRobotDriver() {
  if (state.phase !== 'paused' || !state.targetPoint) return;
  emit({ phase: 'moving' }, 'robot.resumed');
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
