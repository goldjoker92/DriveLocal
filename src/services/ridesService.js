// Rides client service — the ONLY app-side entry point for the secure ride flow.
// Writes go through Cloud Functions callables; reads use secured Firestore listeners.

import { httpsCallable } from 'firebase/functions';
import { doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../config/firebase';
import { logRideClientEvent } from '../utils/clientRideLog';

function makeIdempotencyKey(prefix) {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}${rand}`.slice(0, 40);
}

function hasCoordinatePair(point) {
  if (!point || point.lat == null || point.lng == null || point.lat === '' || point.lng === '') return false;
  return Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
}

export async function requestRide({ vehicleType, pickup, destination, idempotencyKeyRef }) {
  let idempotencyKey;
  if (idempotencyKeyRef) {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = makeIdempotencyKey('ride');
    idempotencyKey = idempotencyKeyRef.current;
  } else {
    idempotencyKey = makeIdempotencyKey('ride');
  }

  const startedAt = Date.now();
  logRideClientEvent('ride.request.callable_started', {
    action: 'createRideRequestSecure', vehicleType,
    hasPickupCoordinates: hasCoordinatePair(pickup),
    hasDestinationCoordinates: hasCoordinatePair(destination),
  });
  try {
    const call = httpsCallable(functions, 'createRideRequestSecure');
    const res = await call({
      vehicleType,
      pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
      destination: { lat: destination.lat, lng: destination.lng, label: destination.label },
      idempotencyKey,
    });
    logRideClientEvent('ride.request.callable_succeeded', {
      action: 'createRideRequestSecure', rideId: res.data?.rideId,
      resultStatus: res.data?.status, vehicleType,
      durationMs: Date.now() - startedAt, ride: res.data,
    });
    return res.data;
  } catch (error) {
    logRideClientEvent('ride.request.callable_failed', {
      action: 'createRideRequestSecure', vehicleType,
      durationMs: Date.now() - startedAt, error,
    }, 'error');
    throw error;
  }
}

export async function acceptOffer(offerId) {
  const startedAt = Date.now();
  logRideClientEvent('ride.offer.accept_started', { action: 'acceptDriverOfferSecure' });
  try {
    const call = httpsCallable(functions, 'acceptDriverOfferSecure');
    const res = await call({ offerId, idempotencyKey: makeIdempotencyKey('acc') });
    logRideClientEvent('ride.offer.accept_succeeded', {
      action: 'acceptDriverOfferSecure', rideId: res.data?.rideId,
      resultStatus: res.data?.status, durationMs: Date.now() - startedAt, ride: res.data,
    });
    return res.data;
  } catch (error) {
    logRideClientEvent('ride.offer.accept_failed', {
      action: 'acceptDriverOfferSecure', durationMs: Date.now() - startedAt, error,
    }, 'error');
    throw error;
  }
}

export async function declineOffer(offerId, reasonCode = 'driver_declined') {
  const call = httpsCallable(functions, 'declineDriverOfferSecure');
  const res = await call({ offerId, reasonCode });
  logRideClientEvent('ride.offer.declined', {
    action: 'declineDriverOfferSecure', rideId: res.data?.rideId, resultStatus: res.data?.status,
  });
  return res.data;
}

async function callRide(name, rideId, extra) {
  const startedAt = Date.now();
  logRideClientEvent('ride.lifecycle.callable_started', { action: name, rideId });
  try {
    const call = httpsCallable(functions, name);
    const res = await call({ rideId, idempotencyKey: makeIdempotencyKey('lc'), ...(extra || {}) });
    logRideClientEvent('ride.lifecycle.callable_succeeded', {
      action: name, rideId, resultStatus: res.data?.status,
      durationMs: Date.now() - startedAt, ride: res.data,
    });
    return res.data;
  } catch (error) {
    logRideClientEvent('ride.lifecycle.callable_failed', {
      action: name, rideId, durationMs: Date.now() - startedAt, error,
    }, 'error');
    throw error;
  }
}

export const markDriverArrived = (rideId) => callRide('markDriverArrivedSecure', rideId);
export const startRide = (rideId) => callRide('startRideSecure', rideId);
export const finishRide = (rideId) => callRide('finishRideSecure', rideId);
export const markPassengerPixSent = (rideId) => callRide('markPassengerPixSentSecure', rideId);
export const confirmDriverPixReceived = (rideId) => callRide('confirmDriverPixReceivedSecure', rideId);
export const cancelRide = (rideId, reasonCode) => callRide('cancelRideSecure', rideId, { reasonCode });
export const reportPaymentIssue = (rideId, reasonCode) => callRide('reportRidePaymentIssueSecure', rideId, { reasonCode });

export function listenToRide(rideId, onData, onError) {
  logRideClientEvent('ride.snapshot.listener_started', { rideId });
  return onSnapshot(doc(db, 'rideRequests', rideId), (snap) => {
    const ride = snap.exists() ? { rideId: snap.id, ...snap.data() } : null;
    logRideClientEvent('ride.snapshot.received', { rideId, status: ride?.status || 'missing', ride });
    onData(ride);
  }, (error) => {
    logRideClientEvent('ride.snapshot.listener_failed', { rideId, error }, 'error');
    if (onError) onError(error);
  });
}

export function listenToRideLocation(rideId, onData, onError) {
  logRideClientEvent('ride.location.listener_started', { rideId });
  return onSnapshot(doc(db, 'activeRideLocations', rideId), (snap) => {
    const location = snap.exists() ? { rideId: snap.id, ...snap.data() } : null;
    logRideClientEvent('ride.location.snapshot_received', { rideId, status: location ? 'available' : 'missing' });
    onData(location);
  }, (error) => {
    logRideClientEvent('ride.location.listener_failed', { rideId, error }, 'error');
    if (onError) onError(error);
  });
}

function newer(current, candidate) {
  if (!current) return candidate;
  return Number(candidate.createdAtMs || 0) > Number(current.createdAtMs || 0) ? candidate : current;
}

const TERMINAL_DRIVER_RIDE_STATUSES = new Set(['completed', 'cancelled', 'disputed']);

export function listenToMyOffer(driverUid, onData, onError, rideId = null) {
  const q = query(collection(db, 'driverOffers'), where('driverId', '==', driverUid));
  return onSnapshot(q, (snap) => {
    let offered = null;
    let accepted = null;
    const nowMs = Date.now();
    snap.forEach((d) => {
      const data = d.data();
      if (rideId && data.rideId !== rideId) return;
      const candidate = { offerId: d.id, ...data };
      if (data.status === 'accepted') {
        // Driver home ignores historical terminal offers. An explicitly opened ride,
        // however, keeps receiving its final status so success/error feedback can be
        // shown before the payment screen closes.
        if (rideId || !TERMINAL_DRIVER_RIDE_STATUSES.has(data.driverRideStatus)) {
          accepted = newer(accepted, candidate);
        }
      } else if (data.status === 'offered' && Number(data.expiresAtMs || 0) > nowMs) {
        offered = newer(offered, candidate);
      }
    });

    const selected = accepted || offered;
    logRideClientEvent('ride.driver_offer.snapshot_received', {
      rideId: selected?.rideId || rideId,
      offerStatus: selected?.status || 'missing',
      driverRideStatus: selected?.driverRideStatus || null,
      hasPaymentAmount: selected?.paymentAmountCentavos != null,
      hasPaymentPayload: !!selected?.paymentPixPayload,
    });
    onData(selected);
  }, (err) => {
    logRideClientEvent('ride.driver_offer.listener_failed', { rideId, error: err }, 'error');
    if (onError) onError(err);
  });
}
