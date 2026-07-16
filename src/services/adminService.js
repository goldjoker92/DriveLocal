// Admin client service — the ONLY app-side entry point for secure admin
// operations. Every sensitive mutation goes through an authenticated,
// admin-gated Cloud Functions callable (approval, moderation, suspension,
// dispute resolution, wallet adjustment). The client never writes driver
// approval/founder/verification, ride lifecycle/financial, wallet, or audit
// fields directly. Reads are bounded (explicit limits) and admin-gated by Rules.

import { httpsCallable } from 'firebase/functions';
import {
  collection, query, where, orderBy, limit as fbLimit, getDocs, getDoc, doc,
} from 'firebase/firestore';
import { functions, db } from '../config/firebase';

const DEFAULT_LIMIT = 50;

function idempotencyKey(prefix) {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}${rand}`.slice(0, 40);
}

async function call(name, data) {
  const res = await httpsCallable(functions, name)(data);
  return res.data;
}

// --- Driver moderation (secure callables) ----------------------------------
export const approveDriver = (driverId) => call('approveDriverSecure', { driverId });
export const rejectDriver = (driverId, reason) => call('rejectDriverSecure', { driverId, reason });
export const suspendDriver = (driverId, reason) => call('suspendDriverSecure', { driverId, reason });
export const reactivateDriver = (driverId, reason) => call('reactivateDriverSecure', { driverId, reason });

// --- Ride dispute resolution -----------------------------------------------
// outcome: 'confirm_driver_payment' | 'release_driver_hold' | 'retain_for_manual_review'
export const resolveRideDispute = (rideId, outcome, reason, note) =>
  call('resolveRideDisputeSecure', { rideId, outcome, reason, note: note || null, idempotencyKey: idempotencyKey('disp') });

// --- Wallet adjustment ------------------------------------------------------
// operation: 'credit' | 'debit' | 'correction' | 'reversal'
export function adjustDriverWallet({ driverId, operation, amountCentavos, reasonCode, note, correctionSign, originalLedgerEntryId }) {
  return call('adjustDriverWalletSecure', {
    driverId, operation, amountCentavos, reasonCode, note,
    correctionSign: correctionSign || null,
    originalLedgerEntryId: originalLedgerEntryId || null,
    idempotencyKey: idempotencyKey('wadj'),
  });
}

// --- Bounded admin reads (admin-gated by Rules) ----------------------------
// Drivers filtered by verificationStatus, newest first, hard-capped.
export async function listDriversByStatus(status, max = DEFAULT_LIMIT) {
  const q = query(
    collection(db, 'drivers'),
    where('verificationStatus', '==', status),
    orderBy('createdAt', 'desc'),
    fbLimit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ driverId: d.id, ...d.data() }));
}

// One specific ride by id (never an unbounded scan).
export async function getRideById(rideId) {
  const snap = await getDoc(doc(db, 'rideRequests', rideId));
  return snap.exists() ? { rideId: snap.id, ...snap.data() } : null;
}

// Disputed rides, newest first, hard-capped.
export async function listDisputedRides(max = DEFAULT_LIMIT) {
  const q = query(
    collection(db, 'rideRequests'),
    where('status', '==', 'disputed'),
    orderBy('updatedAt', 'desc'),
    fbLimit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ rideId: d.id, ...d.data() }));
}
