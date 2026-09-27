// Driver service — Firestore reads/writes for the driver lifecycle and the
// admin approve/reject flow. Iteration 1A (Firebase real backend).

import {
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  updateDoc,
  collection,
  query,
  where,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  hasSubmittedCriminalCertificate,
  requiresCriminalCertificate,
} from '../utils/driverDocumentPolicy';

// Profile fields that must all be filled for profileStatus to be "complete".
const REQUIRED_PROFILE_FIELDS = [
  'fullName',
  'whatsApp',
  'cpf',
  'pixKeyType',
  'pixKey',
];


// Reads drivers/{driverId}. Returns the document data, or null when missing.
export async function getDriver(driverId, { serverOnly = false } = {}) {
  const read = serverOnly ? getDocFromServer : getDoc;
  const snap = await read(doc(db, 'drivers', driverId));
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

// Registers only private storage metadata. Unlike legacy image documents, the
// criminal certificate never persists a tokenized download URL in Firestore.
export async function updateCriminalCertificate(driverId, file) {
  if (!driverId || !file?.path || !file?.version || !file?.contentType) {
    throw new Error('updateCriminalCertificate: metadados inválidos');
  }
  console.log('[CRIMINAL_CERTIFICATE] metadata.registration_started', {
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
  });
  await updateDoc(doc(db, 'drivers', driverId), {
    criminalCertificatePath: file.path,
    criminalCertificateVersion: file.version,
    criminalCertificateContentType: file.contentType,
    criminalCertificateSizeBytes: file.sizeBytes,
    criminalCertificateStatus: 'submitted',
    criminalCertificateUploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  console.log('[CRIMINAL_CERTIFICATE] metadata.registration_succeeded');
}

// Checks that every required document has status "submitted".
export function checkAllDocumentsSubmitted(driver) {
  const d = driver || {};
  const required = [...BASE_REQUIRED_DOCS];

  const missing = required.filter((docType) => {
    const fields = DOC_FIELD_MAP[docType];
    return d[fields.status] !== 'submitted';
  });

  if (requiresCriminalCertificate(d) && !hasSubmittedCriminalCertificate(d, d.uid)) {
    missing.push('criminal_certificate');
  }

  console.log('[DRIVER] checkAllDocuments missing=', JSON.stringify(missing));
  return { allSubmitted: missing.length === 0, missing };
}
