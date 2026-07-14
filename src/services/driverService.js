// Driver service Ã¢â‚¬â€ Firestore reads/writes for the driver lifecycle and the
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
import {
  SUBSCRIPTION_COMMISSION_FREE_DAYS,
  SUBSCRIPTION_PAYMENT_MODE,
} from '../constants/subscriptionRules';
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
// availabilityStatus: 'available' | 'offline'. Iteration 2A.
// Eligibility (approved + allowed to receive rides) is enforced by the caller
// via deriveEligibility; this only persists the chosen state. No money moves.
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

// Returns every driver document. Admin-only: Firestore rules only allow reading
// the full "drivers" collection when the caller exists in admins/{uid}. The
// admin console filters by status client-side, so no composite index is needed.
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

  // Guard against double approval: an already-approved driver must not be
  // re-approved, must not re-increment the founder counter, and must not append
  // a duplicate "approved" history entry. No-op, so the caller just reloads.
  if (driver.verificationStatus === 'approved') {
    console.log('[APPROVE] Motorista já aprovado driverId=', driverId, '— ignorado');
    return { alreadyApproved: true };
  }

  const serviceAreaId = driver.serviceAreaId || SERVICE_AREA_HORIZONTE_CE_BR;

  // Business rule: founderNumber must be assigned ATOMICALLY. Two drivers
  // approved at the same time must never get the same number, so the counter is
  // read-and-incremented inside a Firestore transaction (see founderService).
  const { approvalNumber, isFounder, founderNumber } =
    await assignFounderStatusIfEligible(serviceAreaId);
  const now = new Date();

  const base = {
    verificationStatus: 'approved',
    // Business rule: the founder/free windows start at the ADMIN APPROVAL date,
    // not signup. approvedAt is that reference; reviewedAt is kept for history.
    approvedAt: serverTimestamp(),
    reviewedAt: serverTimestamp(),
    reviewedBy: adminUid,
    approvalNumber,
    // Wallet + free-ride counter start neutral on approval (only if not set).
    walletBalanceCentavos: driver.walletBalanceCentavos != null ? driver.walletBalanceCentavos : 0,
    freeRideCountUsed: driver.freeRideCountUsed != null ? driver.freeRideCountUsed : 0,
    statusHistory: arrayUnion({
      status: 'approved',
      changedAt: now,
      changedBy: adminUid,
    }),
  };

  // Approval does NOT move money. It only sets the driver's role, promo window
  // and ride-eligibility flags so the driver cockpit (deriveEligibility) can
  // read a single source of truth. Manual subscription activation for #101+ is
  // deferred to Iteration 2B — approval only writes the "required" state here.
  let roleFields;
  if (isFounder) {
    // Founder #001-#100: subscription and commission are free for the window,
    // and the driver can receive rides immediately.
    const founderCommissionFreeUntil = new Date(now.getTime() + FOUNDER_DEFAULT_COMMISSION_FREE_DAYS * DAY_MS);
    const founderSubscriptionFreeUntil = new Date(now.getTime() + FOUNDER_DEFAULT_SUBSCRIPTION_FREE_DAYS * DAY_MS);
    roleFields = {
      founderEligible: true,
      founderNumber, //  PricingV1: same as approvalNumber for founders.
      founderGrantedAt: serverTimestamp(),
      // Kept for isFounderCommissionFreeActive (drives the cockpit 0% display).
      founderExpiresAt: founderCommissionFreeUntil,
      subscriptionActive: true,
      subscriptionStatus: 'free_founder',
      subscriptionFreeUntil: founderSubscriptionFreeUntil,
      // founderFreeUntil is the PricingV1 alias for the founder subscription-free
      // window (getEffectiveSubscriptionStatus reads either name).
      founderFreeUntil: founderSubscriptionFreeUntil,
      commissionRateBps: 0,
      commissionFreeUntil: founderCommissionFreeUntil,
      canReceiveRides: true,
      canReceiveRidesReason: 'founder_benefit_active',
      walletStatus: 'not_required_during_commission_free_period',
    };
  } else {
    // #101+: approved. Business rule (PricingV1): commission is 0% for the first
    // 60 days from approval, so commissionFreeUntil is set here even though the
    // cockpit gate (canReceiveRides) is left as-is for now.
    //
    // NOTE / DECISION NEEDED: the pricing spec also grants #101+ their first 5
    // completed rides WITHOUT a subscription. That rule is implemented in the
    // isolated helper utils/driverEligibility.js (canDriverReceiveRide), which
    // the future ride-dispatch flow should use. To avoid regressing the current
    // cockpit behavior (Iteration 2B kept #101+ blocked until subscription), we
    // do NOT flip canReceiveRides here. When dispatch is wired, decide whether
    // the cockpit should also adopt the 5-free-rides rule.
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

  // The founder counter was already incremented atomically inside
  // assignFounderStatusIfEligible, so we only persist the driver document here.
  await updateDoc(doc(db, 'drivers', driverId), { ...base, ...roleFields });
  return { approvalNumber, isFounder, founderNumber };
}

// Admin rejects a driver with a reason. Terminal state: the driver stays
// blocked from rides. No money is moved here.
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

// Admin asks the driver to fix/resend something (not a rejection). The driver
// app should surface correctionReason and let them resubmit for review.
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

// True when a driver holds an active founder benefit and must NOT be touched by
// the non-founder subscription actions (protects founder fields, Iteration 2B).
function isFounderDriverDoc(driver) {
  const d = driver || {};
  return d.founderEligible === true || d.subscriptionStatus === 'free_founder';
}

// Admin/dev test action (Iteration 2B): manually mark an approved NON-founder
// driver's subscription as active so #101+ ride-eligibility can be tested before
// real Pix payments exist. Active for 30 days; grants 0% commission for 60 days.
// Refuses to run on founder drivers so their benefits are never overwritten.
// No money is moved and no real payment integration is involved.
export async function activateDriverSubscription(driverId) {
  const driver = (await getDriver(driverId)) || {};
  if (isFounderDriverDoc(driver)) {
    console.log('[SUBSCRIPTION] activate ignorado — motorista fundador driverId=', driverId);
    return { skipped: 'founder' };
  }
  const now = new Date();
  // Business rule (PricingV1): renewal never wastes remaining paid days —
  // newExpiration = max(now, currentSubscriptionExpiresAt) + 30 days.
  const expiresAt = new Date(computeRenewedExpirationMs(driver, now));
  const commissionFreeUntil = new Date(now.getTime() + SUBSCRIPTION_COMMISSION_FREE_DAYS * DAY_MS);
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
    commissionRateBps: 0,
    commissionFreeUntil,
    commissionPromoStatus: 'active_after_subscription',
    walletStatus: 'not_required_during_commission_free_period',
    updatedAt: serverTimestamp(),
  });
  return { activated: true };
}

// Admin/dev test action (Iteration 2B): reset an approved NON-founder driver's
// subscription back to "required" so the #101+ blocked state can be re-tested.
// Also forces availability offline. Refuses to run on founder drivers.
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
    commissionRateBps: 0,
    commissionFreeUntil: null,
    commissionPromoStatus: 'pending_subscription_activation',
    walletStatus: 'not_required_yet',
    availabilityStatus: 'offline',
    updatedAt: serverTimestamp(),
  });
  return { reset: true };
}

// Admin action (PricingV1): activate OR renew a NON-founder driver's paid
// subscription after a Pix payment is confirmed manually. Uses the renewal rule
// max(now, currentExpiration) + 30 days so early renewals never lose paid days.
// vehicleType is used only to record the monthly amount charged (display/audit).
// Refuses to run on founder drivers so their benefits are never overwritten.
// No automatic Pix confirmation — this is triggered by the admin (see §7 spec).
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

// Admin action (PricingV1): block / unblock a driver. Blocking sets isBlocked
// and forces availability offline so a blocked driver receives no rides
// (canDriverReceiveRide -> DRIVER_BLOCKED). No money is moved.
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
// excludeUid is the current driver, so it is not compared against itself.
// Returns { cpf, phone, vehiclePlate, pixKey } as booleans.
export async function checkDuplicates(cpf, phone, vehiclePlate, pixKey, excludeUid) {
  const result = {
    cpf: await fieldExists('cpf', cpf, excludeUid),
    phone: await fieldExists('phone', phone, excludeUid),
    vehiclePlate: await fieldExists('vehiclePlate', vehiclePlate, excludeUid),
    pixKey: await fieldExists('pixKey', pixKey, excludeUid),
  };
  return result;
}

// True when another driver document (id != excludeUid) has field == value.
async function fieldExists(field, value, excludeUid) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return false;
  }
  const q = query(collection(db, 'drivers'), where(field, '==', value));
  const snap = await getDocs(q);
  return snap.docs.some((d) => d.id !== excludeUid);
}

// ---- Iteration 1B additions ------------------------------------------------

// Champs vÃƒÂ©hicule obligatoires pour passer vehicleStatus ÃƒÂ  "complete".
const REQUIRED_VEHICLE_FIELDS = [
  'vehicleType',
  'vehicleBrand',
  'vehicleModel',
  'vehicleColor',
  'vehiclePlate',
  'vehicleYear',
];

// Mapping docType -> { champ URL, champ statut } sur le document driver.
const DOC_FIELD_MAP = {
  selfie: { url: 'selfieUrl', status: 'selfieStatus' },
  cnh_frente: { url: 'cnhFrenteUrl', status: 'cnhFrenteStatus' },
  cnh_verso: { url: 'cnhVersoUrl', status: 'cnhVersoStatus' },
  crlv: { url: 'crlvUrl', status: 'crlvStatus' },
  vehicle_photo: { url: 'vehiclePhotoUrl', status: 'vehiclePhotoStatus' },
  motofrete_cert: { url: 'motofreteUrl', status: 'motofreteStatus' },
};

// Documents obligatoires pour tous + le certificat motofrete pour la moto.
const BASE_REQUIRED_DOCS = ['selfie', 'cnh_frente', 'cnh_verso', 'crlv', 'vehicle_photo'];

// Met ÃƒÂ  jour les infos vÃƒÂ©hicule et recalcule vehicleStatus.
export async function updateVehicleInfo(driverId, vehicleData) {
  console.log('[DRIVER] updateVehicleInfo driverId=', driverId);
  const current = (await getDriver(driverId)) || {};
  const merged = { ...current, ...vehicleData };

  // vehicleStatus "complete" seulement si tous les champs obligatoires sont remplis.
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

// Enregistre l'URL d'un document uploadÃƒÂ© et passe son statut ÃƒÂ  "submitted".
export async function updateDocumentUrl(driverId, docType, url) {
  console.log('[DRIVER] updateDocumentUrl docType=', docType);
  const fields = DOC_FIELD_MAP[docType];
  if (!fields) throw new Error(`updateDocumentUrl: docType invÃƒÂ¡lido (${docType})`);

  await updateDoc(doc(db, 'drivers', driverId), {
    [fields.url]: url,
    [fields.status]: 'submitted',
    updatedAt: serverTimestamp(),
  });
}

// VÃƒÂ©rifie que tous les documents obligatoires ont le statut "submitted".
// La moto exige en plus motofrete_cert. Retourne { allSubmitted, missing }.
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
