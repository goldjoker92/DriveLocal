// Passenger service (Iteration 3A). Firestore reads for the passenger profile.
// Passenger CREATION lives in authService.registerPassenger (mirrors the driver
// pattern). No CPF for passengers in V1.

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// Reads passengers/{uid}. Returns the document data, or null when missing.
export async function getPassenger(uid) {
  const snap = await getDoc(doc(db, 'passengers', uid));
  return snap.exists() ? snap.data() : null;
}
