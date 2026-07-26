// Admin client service — the ONLY app-side entry point for secure admin
// operations. Sensitive mutations and aggregate/support reads always go through
// authenticated callables. Raw financial ledgers, Pix payloads and precise passenger
// locations are never downloaded by the dashboard or dispute screens.

import { httpsCallable } from 'firebase/functions';
import {
  collection, query, where, orderBy, limit as fbLimit, getDocs,
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

// Privacy-safe server projections: these never return paymentPixPayload, exact
// pickup/destination, contact details or private document data.
export const getRideById = (rideId) =>
  call('getAdminRideSummarySecure', { rideId });

export async function listDisputedRides(max = DEFAULT_LIMIT) {
  const result = await call('listAdminDisputedRidesSecure', { limit: max });
  return result?.rides || [];
}

// --- Minimal support queue --------------------------------------------------
export async function listAdminSupportTickets(status = 'open', max = DEFAULT_LIMIT) {
  const result = await call('listAdminSupportTicketsSecure', { status, limit: max });
  return result?.tickets || [];
}

export const updateAdminSupportTicket = ({ ticketId, status, resolutionCode = null }) =>
  call('updateAdminSupportTicketSecure', {
    ticketId,
    status,
    resolutionCode,
    idempotencyKey: idempotencyKey('support'),
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