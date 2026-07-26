// Passenger service (Iteration 3A). Firestore reads for the passenger profile.
// Passenger CREATION lives in authService.registerPassenger (mirrors the driver
// pattern). No CPF for passengers in V1.

import { doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getDocumentWithCacheFallback } from './firestoreRecovery';

// Reads passengers/{uid}. A recent Firestore cache may restore the home screen
// while offline; server mutations remain callable-only and are never authorized by it.
export async function getPassenger(uid) {
  const snap = await getDocumentWithCacheFallback(
    doc(db, 'passengers', uid),
    'passenger_profile'
  );
  return snap.exists() ? snap.data() : null;
}
