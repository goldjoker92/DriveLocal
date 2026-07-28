// Passenger service (Iteration 3A). Firestore reads for the passenger profile
// and the passenger-owned ride history.
// Passenger CREATION lives in authService.registerPassenger (mirrors the driver
// pattern). No CPF for passengers in V1.

import {
  collection,
  doc,
  getDocs,
  limit as queryLimit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getDocumentWithCacheFallback } from './firestoreRecovery';

const PASSENGER_HISTORY_READ_LIMIT = 100;

// Reads passengers/{uid}. A recent Firestore cache may restore the home screen
// while offline; server mutations remain callable-only and are never authorized by it.
export async function getPassenger(uid) {
  const snap = await getDocumentWithCacheFallback(
    doc(db, 'passengers', uid),
    'passenger_profile'
  );
  return snap.exists() ? snap.data() : null;
}

// Firestore Rules require the passengerId equality filter, so a passenger can
// never broaden this query to another account. The bounded V1 result is sorted
// and filtered by the pure dashboard policy after retrieval, avoiding a new
// composite index solely for the first pilot history screen.
export async function getPassengerRideHistory(uid) {
  if (!uid) return [];
  const historyQuery = query(
    collection(db, 'rideRequests'),
    where('passengerId', '==', uid),
    queryLimit(PASSENGER_HISTORY_READ_LIMIT)
  );
  const snapshot = await getDocs(historyQuery);
  return snapshot.docs.map((rideDocument) => ({
    rideId: rideDocument.id,
    ...rideDocument.data(),
  }));
}
