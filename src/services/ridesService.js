// Rides client service — the ONLY app-side entry point for the secure ride flow.
// Writes go through Cloud Functions callables; reads use secured Firestore listeners.

import { httpsCallable } from 'firebase/functions';
import {
  doc,
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { functions, db } from '../config/firebase';
import {
  DRIVER_CANCELLATION_REASONS,
  PASSENGER_CANCELLATION_REASONS,
  normalizeCancellationReason,
} from '../constants/rideCancellation';
import { QUICK_MESSAGE_HISTORY_LIMIT } from '../constants/rideQuickMessages';
import { logRideClientEvent } from '../utils/clientRideLog';
import { getDriverTrackingSession } from './driverLocationTracking';
import { chooseCancellationReason } from './rideCancellationPrompt';

const LEGACY_CANCELLATION_CODES = new Set(['motorista_cancelou', 'passageiro_cancelou']);

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

function cancellationRole(reasonCode, explicitRole) {
  if (explicitRole === 'driver' || explicitRole === 'passenger') return explicitRole;
  const code = String(reasonCode || '');
  if (code === 'passageiro_cancelou' || PASSENGER_CANCELLATION_REASONS.some((reason) => reason.code === code)) {
    return 'passenger';
  }
  if (code === 'motorista_cancelou' || DRIVER_CANCELLATION_REASONS.some((reason) => reason.code === code)) {
    return 'driver';
  }
  return null;
}

function cancellationSelectionDismissedError() {
  const error = new Error('A corrida foi mantida.');
  error.code = 'CANCELLATION_SELECTION_DISMISSED';
  return error;
}

export const markDriverArrived = (rideId) => callRide('markDriverArrivedSecure', rideId);
export const startRide = (rideId) => callRide('startRideSecure', rideId);
export const finishRide = (rideId) => callRide('finishRideSecure', rideId);
export const markPassengerPixSent = (rideId) => callRide('markPassengerPixSentSecure', rideId);
export const confirmDriverPixReceived = (rideId) => callRide('confirmDriverPixReceivedSecure', rideId);
export async function cancelRide(rideId, reasonCode, role = null) {
  const actorRole = cancellationRole(reasonCode, role);
  let selectedReasonCode = reasonCode;
  if (LEGACY_CANCELLATION_CODES.has(String(reasonCode || ''))) {
    selectedReasonCode = await chooseCancellationReason(actorRole);
    if (!selectedReasonCode) throw cancellationSelectionDismissedError();
  }
  const normalizedReasonCode = normalizeCancellationReason(selectedReasonCode, actorRole);
  return callRide('cancelRideSecure', rideId, { reasonCode: normalizedReasonCode });
}
export const reportPassengerNotFound = (rideId) => cancelRide(rideId, 'passenger_no_show', 'driver');
export const sendRideQuickMessage = (rideId, messageCode) =>
  callRide('sendRideQuickMessageSecure', rideId, { messageCode });
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

export function listenToRideQuickMessages(rideId, onData, onError) {
  // The backend owns exactly six reusable slots, so sorting locally avoids a new
  // Firestore index and keeps this listener compatible with existing test mocks.
  const messagesRef = collection(db, 'rideRequests', rideId, 'quickMessages');
  logRideClientEvent('ride.quick_messages.listener_started', { rideId });
  return onSnapshot(messagesRef, (snap) => {
    const nowMs = Date.now();
    const messages = snap.docs
      .map((messageSnap) => ({ messageId: messageSnap.id, ...messageSnap.data() }))
      .filter((message) => !message.expiresAtMs || Number(message.expiresAtMs) > nowMs)
      .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0))
      .slice(0, QUICK_MESSAGE_HISTORY_LIMIT);
    logRideClientEvent('ride.quick_messages.snapshot_received', {
      rideId,
      messageCount: messages.length,
      latestMessageCode: messages[0]?.messageCode || null,
    });
    onData(messages);
  }, (error) => {
    logRideClientEvent('ride.quick_messages.listener_failed', { rideId, error }, 'error');
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
  let snapshotRevision = 0;

  return onSnapshot(q, async (snap) => {
    const revision = ++snapshotRevision;
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

    let selected = accepted || offered;

    // Accepted rides remain recoverable even after a process restart. A merely
    // offered ride, however, belongs to exactly one work session and must never be
    // shown from an old Android notification or an old Firestore snapshot.
    if (selected?.status === 'offered') {
      const trackingSession = await getDriverTrackingSession();
      if (revision !== snapshotRevision) return;
      const sessionMatches = Boolean(
        trackingSession?.driverId === driverUid
        && trackingSession?.availabilitySessionId
        && selected.availabilitySessionId === trackingSession.availabilitySessionId
      );
      if (!sessionMatches) {
        logRideClientEvent('ride.driver_offer.stale_session_ignored', {
          action: 'filter_targeted_offer',
          rideId: selected.rideId,
          offerId: selected.offerId,
          reason: trackingSession ? 'availability_session_mismatch' : 'local_work_session_missing',
          resultStatus: 'ignored',
        }, 'warning');
        selected = null;
      }
    }

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
