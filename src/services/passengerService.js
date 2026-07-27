// Passenger service. Firestore reads for the passenger profile.
// Passenger CREATION lives in authService.registerPassenger. No CPF for passengers
// in V1. Server mutations remain callable-only.

import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getDocumentWithCacheFallback } from './firestoreRecovery';

// Reads passengers/{uid}. A recent Firestore cache may restore the home screen
// while offline; server mutations are never authorized by this cached view.
export async function getPassenger(uid) {
  const snap = await getDocumentWithCacheFallback(
    doc(db, 'passengers', uid),
    'passenger_profile'
  );
  return snap.exists() ? snap.data() : null;
}

// The passenger dashboard must react immediately when the server assigns, completes
// or clears an active ride. Metadata is forwarded so callers can distinguish cache
// restoration from a server-confirmed profile snapshot when needed.
export function listenToPassenger(uid, onData, onError) {
  if (!uid) return () => undefined;
  return onSnapshot(
    doc(db, 'passengers', uid),
    { includeMetadataChanges: true },
    (snapshot) => {
      onData(
        snapshot.exists() ? snapshot.data() : null,
        snapshot.metadata || {}
      );
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}