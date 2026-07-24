// Driver service — Firestore reads/writes for the driver lifecycle and the
// admin approve/reject flow. Iteration 1A (Firebase real backend).

import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  collection,
  query,
  where,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';
import {
  FOUNDER_DEFAULT_COMMISSION_FREE_DAYS,
  FOUNDER_DEFAULT_SUBSCRIPTION_FREE_DAYS,
} from '../constants/founderOfferRules';
import { assignFounderStatusIfEligible } from './founderService';
import { SUBSCRIPTION_PAYMENT_MODE } from '../constants/subscriptionRules';
import {
  computeRenewedExpirationMs,
  getSubscriptionMonthlyCentavos,
} from '../utils/driverSubscription';

// Profile fields that must all be filled for profileStatus to be "complete".
const REQUIRED_PROFILE_FIELDS = [
  'fullName',
  'whatsApp',
  'cpf',
  'pixKeyType',
  'pixKey',
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Reads drivers/{driverId}. Returns the document data, or null when missing.
export async function getDriver(driverId) {
  const snap = await getDoc(doc(db, 'drivers', driverId));
  return snap.exists() ? snap.data() : null;
}

// Updates the driver profile and recomputes profileStatus.
export async function updateDriverProfile(driverId, profileData) {
  const current = (await getDriver(driverId)) || {};
  const merged = { ...current, ...profileData };

  const complete = REQUIRED_PROFILE_FIELDS.every((field) => {
    const value = merged[field];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });

  await updateDoc(doc(db, 'drivers', driverId), {
    ...profileData,
    profileStatus: complete ? 'complete' : 'incomplete',
    updatedAt: serverTimestamp(),
  });
}

// Sets the approved driver's availability (drivers/{uid}.availabilityStatus).
// Eligibility is enforced by the caller; this only persists the chosen state.
export async function setDriverAvailability(driverId, availabilityStatus) {
  console.log('[AVAILABILITY] setDriverAvailability', driverId, availabilityStatus);
  await updateDoc(doc(db, 'drivers', driverId), {
    availabilityStatus,
    availabilityUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Runs duplicate checks, then moves the driver to "pending_review".
export async function submitForReview(driverId) {
  await updateDoc(doc(db, 'drivers', driverId), {
    verificationStatus: 'pending_review',
    duplicateCheckStatus: 'pending_admin_review',
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// Returns all drivers currently waiting for admin review.
export async function getPendingDrivers() {
  const q = query(
    collection(db, 'drivers'),
    where('verificationStatus', '==', 'pending_review')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Returns every driver document. Admin-only through Firestore rules.
export async function getAllDrivers() {
  const snap = await getDocs(collection(db, 'drivers'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Returns drivers matching a single verificationStatus.
export async function getDriversByStatus(status) {
  const q = query(collection(db, 'drivers'), where('verificationStatus', '==', status));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Admin approves a driver. Applies founder or standard (#101+) rules and
// increments the per-service-area approved counter.
export async function approveDriver(driverId, adminUid) {
  const driver = (await getDriver(driverId)) || {};

  // Guard against double approval.
  if (driver.verificationStatus === 'approved') {
    console.log('[APPROVE] Motorista já aprovado driverId=', driverId, '— ignorado');
    return { alreadyApproved: true };
  }

  const serviceAreaId = driver.serviceAreaId || SERVICE_AREA_HORIZONTE_CE_BR;
  const { approvalNumber, isFounder, founderNumber } =
    await assignFounderStatusIfEligible(serviceAreaId);
  const now = new Date();

  const base = {
    verificationStatus: 'approved',
    // Both 60-day windows start at the admin approval date.
    approvedAt: serverTimestamp(),
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    approvalNumber,
    walletBalanceCentavos: driver.walletBalanceCentavos != null ? driver.walletBalanceCentavos : 0,
    freeRideCountUsed: driver.freeRideCountUsed != null ? driver.freeRideCountUsed : 0,
    statusHistory: arrayUnion({
      status: 'approved',
      changedAt: now,
      changedBy: adminUid,
    }),
  };

  let roleFields;
  if (isFounder) {
    const founderCommissionFreeUntil = new Date(
      now.getTime() + FOUNDER_DEFAULT_COMMISSION_FREE_DAYS * DAY_MS
    );
    const founderSubscriptionFreeUntil = new Date(
      now.getTime() + FOUNDER_DEFAULT_SUBSCRIPTION_FREE_DAYS * DAY_MS
    );
    roleFields = {
      founderEligible: true,
      founderNumber,
      founderGrantedAt: serverTimestamp(),
      founderExpiresAt: founderCommissionFreeUntil,
      subscriptionActive: true,
      subscriptionStatus: 'free_founder',
      subscriptionFreeUntil: founderSubscriptionFreeUntil,
      founderFreeUntil: founderSubscriptionFreeUntil,
      commissionRateBps: 0,
      commissionFreeUntil: founderCommissionFreeUntil,
      canReceiveRides: true,
      canReceiveRidesReason: 'founder_benefit_active',
      walletStatus: 'not_required_during_commission_free_period',
    };
  } else {
    const nonFounderCommissionFreeUntil = new Date(
      now.getTime() + FOUNDER_DEFAULT_COMMISSION_FREE_DAYS * DAY_MS
    );
    roleFields = {
      founderEligible: false,
      subscriptionActive: false,
      subscriptionStatus: 'required',
      subscriptionFreeUntil: null,
      commissionRateBps: 0,
      commissionFreeUntil: nonFounderCommissionFreeUntil,
      commissionPromoStatus: 'launch_commission_free',
      canReceiveRides: false,
      canReceiveRidesReason: 'subscription_required',
      walletStatus: 'not_required_during_commission_free_period',
    };
  }

  await updateDoc(doc(db, 'drivers', driverId), { ...base, ...roleFields });
  return { approvalNumber, isFounder, founderNumber };
}

// Admin rejects a driver with a reason.
export async function rejectDriver(driverId, adminUid, rejectionReason) {
  const now = new Date();
  await updateDoc(doc(db, 'drivers', driverId), {
    verificationStatus: 'rejected',
    rejectionReason: rejectionReason || '',
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    updatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      status: 'rejected',
      changedAt: now,
      changedBy: adminUid,
      reason: rejectionReason || '',
    }),
  });
}

// Admin asks the driver to fix/resend something (not a rejection).
export async function requestDriverCorrection(driverId, adminUid, correctionReason) {
  const now = new Date();
  await updateDoc(doc(db, 'drivers', driverId), {
    verificationStatus: 'correction_requested',
    correctionReason: correctionReason || '',
    correctionRequestedAt: serverTimestamp(),
    reviewedBy: adminUid,
    updatedAt: serverTimestamp(),
    statusHistory: arrayUnion({
      status: 'correction_requested',
      changedAt: now,
      changedBy: adminUid,
      reason: correctionReason || '',
    }),
  });
}

// Protects founder fields from non-founder subscription actions.
function isFounderDriverDoc(driver) {
  const d = driver || {};
  return d.founderEligible === true || d.subscriptionStatus === 'free_founder';
}

// Admin/dev test action: activate or renew a NON-founder subscription for 30 days.
// Subscription and commission are independent: this action MUST NOT create,
// restart, extend, shorten or remove the approval-based 60-day commission window.
export async function activateDriverSubscription(driverId) {
  const driver = (await getDriver(driverId)) || {};
  if (isFounderDriverDoc(driver)) {
    console.log('[SUBSCRIPTION] activate ignorado — motorista fundador driverId=', driverId);
    return { skipped: 'founder' };
  }

  const now = new Date();
  const expiresAt = new Date(computeRenewedExpirationMs(driver, now));
  console.log('[SubscriptionV1] activate/renew driverId=', driverId, 'expiresAt=', expiresAt.toISOString());

  await updateDoc(doc(db, 'drivers', driverId), {
    subscriptionStatus: 'active',
    subscriptionActive: true,
    subscriptionActivatedAt: serverTimestamp(),
    subscriptionExpiresAt: expiresAt,
    subscriptionPaymentMode: SUBSCRIPTION_PAYMENT_MODE.MANUAL_ADMIN_TEST,
    subscriptionLastConfirmedAt: serverTimestamp(),
    canReceiveRides: true,
    canReceiveRidesReason: 'subscription_active',
    updatedAt: serverTimestamp(),
  });
  return { activated: true, expiresAtMs: expiresAt.getTime() };
}

// Admin/dev test action: reset an approved NON-founder subscription to required.
// This also leaves commissionFreeUntil untouched; resetting a plan cannot cancel
// or restart the 60-day commission benefit granted at approval.
export async function resetDriverSubscription(driverId) {
  const driver = (await getDriver(driverId)) || {};
  if (isFounderDriverDoc(driver)) {
    console.log('[SUBSCRIPTION] reset ignorado — motorista fundador driverId=', driverId);
    return { skipped: 'founder' };
  }
  console.log('[SUBSCRIPTION] reset driverId=', driverId);
  await updateDoc(doc(db, 'drivers', driverId), {
    subscriptionStatus: 'required',
    subscriptionActive: false,
    subscriptionActivatedAt: null,
    subscriptionExpiresAt: null,
    subscriptionPaymentMode: null,
    subscriptionLastConfirmedAt: null,
    canReceiveRides: false,
    canReceiveRidesReason: 'subscription_required',
    availabilityStatus: 'offline',
    updatedAt: serverTimestamp(),
  });
  return { reset: true };
}

// Admin action: activate or renew a NON-founder paid subscription after a manual
// Pix confirmation. Early renewals keep their remaining paid days.
export async function extendDriverSubscription(driverId, vehicleType) {
  const driver = (await getDriver(driverId)) || {};
  if (isFounderDriverDoc(driver)) {
    console.log('[SubscriptionV1] extend ignored — founder driverId=', driverId);
    return { skipped: 'founder' };
  }
  const now = new Date();
  const expiresAt = new Date(computeRenewedExpirationMs(driver, now));
  const monthlyCentavos = getSubscriptionMonthlyCentavos(vehicleType || driver.vehicleType);
  console.log('[SubscriptionV1] extend driverId=', driverId, 'expiresAt=', expiresAt.toISOString());
  await updateDoc(doc(db, 'drivers', driverId), {
    subscriptionStatus: 'active',
    subscriptionActive: true,
    subscriptionExpiresAt: expiresAt,
    subscriptionLastAmountCentavos: monthlyCentavos,
    subscriptionPaymentMode: SUBSCRIPTION_PAYMENT_MODE.MANUAL_PIX,
    subscriptionLastConfirmedAt: serverTimestamp(),
    canReceiveRides: true,
    canReceiveRidesReason: 'subscription_active',
    updatedAt: serverTimestamp(),
  });
  return { extended: true, expiresAtMs: expiresAt.getTime() };
}

// Admin action: block / unblock a driver.
export async function blockDriver(driverId, adminUid, reason) {
  console.log('[DriverEligibility] block driverId=', driverId);
  await updateDoc(doc(db, 'drivers', driverId), {
    isBlocked: true,
    blockReason: reason || '',
    blockedAt: serverTimestamp(),
    blockedBy: adminUid || null,
    availabilityStatus: 'offline',
    updatedAt: serverTimestamp(),
  });
}

export async function unblockDriver(driverId, adminUid) {
  console.log('[DriverEligibility] unblock driverId=', driverId);
  await updateDoc(doc(db, 'drivers', driverId), {
    isBlocked: false,
    blockReason: null,
    unblockedAt: serverTimestamp(),
    unblockedBy: adminUid || null,
    updatedAt: serverTimestamp(),
  });
}

// Checks whether the given identity values already exist on another driver.
export async function checkDuplicates(cpf, phone, vehiclePlate, pixKey, excludeUid) {
  return {
    cpf: await fieldExists('cpf', cpf, excludeUid),
    phone: await fieldExists('phone', phone, excludeUid),
    vehiclePlate: await fieldExists('vehiclePlate', vehiclePlate, excludeUid),
    pixKey: await fieldExists('pixKey', pixKey, excludeUid),
  };
}

async function fieldExists(field, value, excludeUid) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return false;
  }
  const q = query(collection(db, 'drivers'), where(field, '==', value));
  const snap = await getDocs(q);
  return snap.docs.some((d) => d.id !== excludeUid);
}

// ---- Iteration 1B additions ------------------------------------------------

const REQUIRED_VEHICLE_FIELDS = [
  'vehicleType',
  'vehicleBrand',
  'vehicleModel',
  'vehicleColor',
  'vehiclePlate',
  'vehicleYear',
];

const DOC_FIELD_MAP = {
  selfie: { url: 'selfieUrl', status: 'selfieStatus' },
  cnh_frente: { url: 'cnhFrenteUrl', status: 'cnhFrenteStatus' },
  cnh_verso: { url: 'cnhVersoUrl', status: 'cnhVersoStatus' },
  crlv: { url: 'crlvUrl', status: 'crlvStatus' },
  vehicle_photo: { url: 'vehiclePhotoUrl', status: 'vehiclePhotoStatus' },
  motofrete_cert: { url: 'motofreteUrl', status: 'motofreteStatus' },
};

const BASE_REQUIRED_DOCS = ['selfie', 'cnh_frente', 'cnh_verso', 'crlv', 'vehicle_photo'];

// Updates vehicle information and recomputes vehicleStatus.
export async function updateVehicleInfo(driverId, vehicleData) {
  console.log('[DRIVER] updateVehicleInfo driverId=', driverId);
  const current = (await getDriver(driverId)) || {};
  const merged = { ...current, ...vehicleData };

  const complete = REQUIRED_VEHICLE_FIELDS.every((field) => {
    const value = merged[field];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });

  await updateDoc(doc(db, 'drivers', driverId), {
    ...vehicleData,
    vehicleStatus: complete ? 'complete' : 'incomplete',
    updatedAt: serverTimestamp(),
  });
}

// Stores an uploaded document URL and marks it submitted.
export async function updateDocumentUrl(driverId, docType, url) {
  console.log('[DRIVER] updateDocumentUrl docType=', docType);
  const fields = DOC_FIELD_MAP[docType];
  if (!fields) throw new Error(`updateDocumentUrl: docType inválido (${docType})`);

  await updateDoc(doc(db, 'drivers', driverId), {
    [fields.url]: url,
    [fields.status]: 'submitted',
    updatedAt: serverTimestamp(),
  });
}

// Checks that every required document has status "submitted".
export function checkAllDocumentsSubmitted(driver, vehicleType) {
  const d = driver || {};
  const required = [...BASE_REQUIRED_DOCS];
  if (vehicleType === 'moto') required.push('motofrete_cert');

  const missing = required.filter((docType) => {
    const fields = DOC_FIELD_MAP[docType];
    return d[fields.status] !== 'submitted';
  });

  console.log('[DRIVER] checkAllDocuments missing=', JSON.stringify(missing));
  return { allSubmitted: missing.length === 0, missing };
}
