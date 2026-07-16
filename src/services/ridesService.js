// Rides client service — the ONLY app-side entry point for the secure ride flow.
// Writes go through Cloud Functions callables; reads use secured Firestore
// listeners (BLOCK 04 Rules: a passenger reads only their own ride; a driver
// reads only offers where driverId == their uid). The client never writes
// rideRequests, driverOffers, wallet, or driver financial fields directly.

import { httpsCallable } from 'firebase/functions';
import { doc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../config/firebase';

function makeIdempotencyKey(prefix) {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}${rand}`.slice(0, 40);
}

// Requests a ride. pickup/destination are { lat, lng, label? }. The server owns
// the fare, distance, duration and commission — none are sent from here.
//
// idempotencyKeyRef (optional React ref): one key per request ATTEMPT, REUSED on
// timeout/connection retry so a retried request never creates a second ride. The
// caller clears the ref only when starting a genuinely new request.
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
  return res.data; // { rideId, status, estimatedFareCentavos, ... }
}

// Accepts a targeted offer. Returns the winning-driver view including the exact
// pickup for navigation.
export async function acceptOffer(offerId) {
  const call = httpsCallable(functions, 'acceptDriverOfferSecure');
  const res = await call({ offerId, idempotencyKey: makeIdempotencyKey('acc') });
  return res.data; // { rideId, status, pickup, commissionHoldCentavos, ... }
}

// Lifecycle mutations. Status guards on the backend make each call idempotent, so
// a fresh key per tap is safe. The client never writes ride/wallet/payment fields.
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

// Live status of the passenger's own ride. Returns an unsubscribe function.
export function listenToRide(rideId, onData, onError) {
  return onSnapshot(
    doc(db, 'rideRequests', rideId),
    (snap) => onData(snap.exists() ? { rideId: snap.id, ...snap.data() } : null),
    (err) => onError && onError(err)
  );
}

// Live targeted offer for the signed-in driver (driverId == uid). Surfaces an
// 'accepted' offer (carrying exactPickup) with priority so the accepted state —
// and its navigation buttons — is recovered after an app restart; otherwise the
// current 'offered' offer. Returns an unsubscribe function.
export function listenToMyOffer(driverUid, onData, onError) {
  const q = query(collection(db, 'driverOffers'), where('driverId', '==', driverUid));
  return onSnapshot(
    q,
    (snap) => {
      let offered = null;
      let accepted = null;
      snap.forEach((d) => {
        const data = d.data();
        if (data.status === 'accepted') accepted = { offerId: d.id, ...data };
        else if (data.status === 'offered') offered = { offerId: d.id, ...data };
      });
      onData(accepted || offered);
    },
    (err) => onError && onError(err)
  );
}
