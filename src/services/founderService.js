// Founder service — reads/writes the per-service-area approved-driver counter
// and exposes commission helpers. Iteration 1A (Firebase real backend).
//
// The counter lives at counters/founders_{serviceAreaId} and is the source of
// truth for the founder rule: the first 100 admin-approved drivers per service
// area are "Motorista Fundador". "Approved" means admin approved, not registered.

import {
  doc,
  getDoc,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { FOUNDER_DEFAULT_MAX_DRIVERS } from '../constants/founderOfferRules';

// Builds the counter document reference for a service area.
function counterRef(serviceAreaId) {
  return doc(db, 'counters', `founders_${serviceAreaId}`);
}

// Reads the current approved-driver count for a service area.
// Returns 0 when the counter document does not exist yet.
export async function getApprovedCount(serviceAreaId) {
  const snap = await getDoc(counterRef(serviceAreaId));
  if (!snap.exists()) return 0;
  const data = snap.data();
  return data.approvedCount || 0;
}

// Increments the approved-driver count by 1 inside a transaction.
// Creates the counter document if it does not exist yet.
export async function incrementApprovedCount(serviceAreaId) {
  const ref = counterRef(serviceAreaId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data().approvedCount || 0 : 0;
    tx.set(ref, { approvedCount: current + 1 }, { merge: true });
  });
}

// True while there is still a founder slot available in the service area.
export async function isFounderEligible(serviceAreaId) {
  const count = await getApprovedCount(serviceAreaId);
  return count < FOUNDER_DEFAULT_MAX_DRIVERS;
}

// True when a driver is a founder AND still inside the commission-free window.
export function isFounderCommissionFreeActive(driver) {
  if (!driver || driver.founderEligible !== true) return false;
  if (!driver.founderExpiresAt) return false;
  const expiresMs = toMillis(driver.founderExpiresAt);
  return expiresMs > Date.now();
}

// Returns the commission rate that applies to a driver right now.
// 0 while founder commission-free, otherwise the standard 15%.
export function getCommissionRate(driver) {
  return isFounderCommissionFreeActive(driver) ? 0 : 0.15;
}

// Normalizes a Firestore Timestamp / Date / epoch-ms value to epoch-ms.
function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}
