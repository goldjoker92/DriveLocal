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
export async function requestRide({ vehicleType, pickup, destination }) {
  const call = httpsCallable(functions, 'createRideRequestSecure');
  const res = await call({
    vehicleType,
    pickup,
    destination,
    idempotencyKey: makeIdempotencyKey('ride'),
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

// Live status of the passenger's own ride. Returns an unsubscribe function.
export function listenToRide(rideId, onData, onError) {
  return onSnapshot(
    doc(db, 'rideRequests', rideId),
    (snap) => onData(snap.exists() ? { rideId: snap.id, ...snap.data() } : null),
    (err) => onError && onError(err)
  );
}

// Live targeted offer for the signed-in driver (driverId == uid), newest first.
// Returns an unsubscribe function.
export function listenToMyOffer(driverUid, onData, onError) {
  const q = query(collection(db, 'driverOffers'), where('driverId', '==', driverUid));
  return onSnapshot(
    q,
    (snap) => {
      let offer = null;
      snap.forEach((d) => {
        const data = d.data();
        if (data.status === 'offered') offer = { offerId: d.id, ...data };
      });
      onData(offer);
    },
    (err) => onError && onError(err)
  );
}
