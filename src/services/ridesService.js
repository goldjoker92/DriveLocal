// Rides client service — the ONLY app-side entry point for the secure ride flow.
// Writes go through Cloud Functions callables; reads use secured Firestore
// listeners. The client never writes ride, offer, wallet or financial fields.

import { httpsCallable } from 'firebase/functions';
import { doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../config/firebase';

function makeIdempotencyKey(prefix) {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}${rand}`.slice(0, 40);
}

export async function requestRide({ vehicleType, pickup, destination, idempotencyKeyRef }) {
  let idempotencyKey;
  if (idempotencyKeyRef) {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = makeIdempotencyKey('ride');
    idempotencyKey = idempotencyKeyRef.current;
  } else {
    idempotencyKey = makeIdempotencyKey('ride');
  }
  const call = httpsCallable(functions, 'createRideRequestSecure');
  const res = await call({
    vehicleType,
    pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
    destination: { lat: destination.lat, lng: destination.lng, label: destination.label },
    idempotencyKey,
  });
  return res.data;
}

export async function acceptOffer(offerId) {
  const call = httpsCallable(functions, 'acceptDriverOfferSecure');
  const res = await call({ offerId, idempotencyKey: makeIdempotencyKey('acc') });
  return res.data;
}

async function callRide(name, rideId, extra) {
  const call = httpsCallable(functions, name);
  const res = await call({ rideId, idempotencyKey: makeIdempotencyKey('lc'), ...(extra || {}) });
  return res.data;
}
export const markDriverArrived = (rideId) => callRide('markDriverArrivedSecure', rideId);
export const startRide = (rideId) => callRide('startRideSecure', rideId);
export const finishRide = (rideId) => callRide('finishRideSecure', rideId);
export const markPassengerPixSent = (rideId) => callRide('markPassengerPixSentSecure', rideId);
export const confirmDriverPixReceived = (rideId) => callRide('confirmDriverPixReceivedSecure', rideId);
export const cancelRide = (rideId, reasonCode) => callRide('cancelRideSecure', rideId, { reasonCode });
export const reportPaymentIssue = (rideId, reasonCode) => callRide('reportRidePaymentIssueSecure', rideId, { reasonCode });

export function listenToRide(rideId, onData, onError) {
  return onSnapshot(
    doc(db, 'rideRequests', rideId),
    (snap) => onData(snap.exists() ? { rideId: snap.id, ...snap.data() } : null),
    (err) => onError && onError(err)
  );
}

function newer(current, candidate) {
  if (!current) return candidate;
  return Number(candidate.createdAtMs || 0) > Number(current.createdAtMs || 0) ? candidate : current;
}

const TERMINAL_DRIVER_RIDE_STATUSES = new Set(['completed', 'cancelled', 'disputed']);

// Live targeted offer for the signed-in driver. When rideId is supplied, only
// that ride can drive the active screen. Terminal historical accepted offers are
// ignored so they never hide a new incoming offer.
export function listenToMyOffer(driverUid, onData, onError, rideId = null) {
  const q = query(collection(db, 'driverOffers'), where('driverId', '==', driverUid));
  return onSnapshot(
    q,
    (snap) => {
      let offered = null;
      let accepted = null;
      snap.forEach((d) => {
        const data = d.data();
        if (rideId && data.rideId !== rideId) return;
        const candidate = { offerId: d.id, ...data };
        if (data.status === 'accepted') {
          if (!TERMINAL_DRIVER_RIDE_STATUSES.has(data.driverRideStatus)) {
            accepted = newer(accepted, candidate);
          }
        } else if (data.status === 'offered') {
          offered = newer(offered, candidate);
        }
      });
      onData(accepted || offered);
    },
    (err) => onError && onError(err)
  );
}
