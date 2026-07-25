// Admin client service — the ONLY app-side entry point for secure admin
// operations. Sensitive mutations and aggregate business reads always go through
// authenticated callables. Raw financial ledgers and precise passenger locations
// are never downloaded by the dashboard.

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
// duplicateOverrideReason is optional and must be supplied only after the admin
// reviewed the duplicate indicators shown by the backend.
export const approveDriver = (driverId, duplicateOverrideReason = null) =>
  call('approveDriverSecure', {
    driverId,
    duplicateOverrideReason: duplicateOverrideReason || null,
  });
export const rejectDriver = (driverId, reason) => call('rejectDriverSecure', { driverId, reason });
export const suspendDriver = (driverId, reason) => call('suspendDriverSecure', { driverId, reason });
export const reactivateDriver = (driverId, reason) => call('reactivateDriverSecure', { driverId, reason });

// --- Driver photo review ----------------------------------------------------
// expectedVersion prevents an admin action on an older screen from approving or
// rejecting a newer candidate submitted in the meantime.
export const approveDriverPhoto = (driverId, expectedVersion) =>
  call('approveDriverPhotoSecure', { driverId, expectedVersion });
export const rejectDriverPhoto = (driverId, expectedVersion, reasonCode, reason) =>
  call('rejectDriverPhotoSecure', {
    driverId,
    expectedVersion,
    reasonCode,
    reason: reason || null,
  });

// --- Ride dispute resolution -----------------------------------------------
export const resolveRideDispute = (rideId, outcome, reason, note) =>
  call('resolveRideDisputeSecure', {
    rideId,
    outcome,
    reason,
    note: note || null,
    idempotencyKey: idempotencyKey('disp'),
  });

// --- Wallet adjustment ------------------------------------------------------
export function adjustDriverWallet({
  driverId,
  operation,
  amountCentavos,
  reasonCode,
  note,
  correctionSign,
  originalLedgerEntryId,
}) {
  return call('adjustDriverWalletSecure', {
    driverId,
    operation,
    amountCentavos,
    reasonCode,
    note,
    correctionSign: correctionSign || null,
    originalLedgerEntryId: originalLedgerEntryId || null,
    idempotencyKey: idempotencyKey('wadj'),
  });
}

// --- Business / antifraud analytics ----------------------------------------
// Server returns aggregates only. Supported launch windows: 1, 7, 30 or 90 days.
export const getAdminBusinessAnalytics = (rangeDays = 30) =>
  call('getAdminBusinessAnalyticsSecure', { rangeDays });

// --- Antifraud review queue -------------------------------------------------
export const listAdminRiskCases = (status = 'open', max = 100) =>
  call('listAdminRiskCasesSecure', { status, limit: max });

export const decideAdminRiskCase = ({
  caseId,
  outcome,
  reasonCode,
  note,
  restrictionHours,
}) => call('decideAdminRiskCaseSecure', {
  caseId,
  outcome,
  reasonCode,
  note: note || null,
  restrictionHours: restrictionHours == null ? null : Number(restrictionHours),
  idempotencyKey: idempotencyKey('risk'),
});

// --- Bounded admin reads ----------------------------------------------------
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

export async function getRideById(rideId) {
  const snap = await getDoc(doc(db, 'rideRequests', rideId));
  return snap.exists() ? { rideId: snap.id, ...snap.data() } : null;
}

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
