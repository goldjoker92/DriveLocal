import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { db, storage } from '../config/firebase';
import { logDriverPhotoEvent } from '../utils/driverPhotoLog';

function privateCandidatePrefix(driverId, version) {
  return `drivers/${driverId}/profile-photo/${version}/`;
}

export async function submitDriverPhotoCandidate({
  driverId,
  version,
  originalPath,
  publicCandidatePath,
}) {
  if (!driverId || !version) throw new Error('Dados da foto incompletos.');
  const prefix = privateCandidatePrefix(driverId, version);
  if (originalPath !== `${prefix}original.jpg`) throw new Error('Caminho original inválido.');
  if (publicCandidatePath !== `${prefix}public-candidate.jpg`) throw new Error('Caminho público candidato inválido.');

  const startedAt = Date.now();
  logDriverPhotoEvent('candidate.submit_started', {
    driverId,
    version,
    status: 'pending',
    hasCandidate: true,
  });

  await updateDoc(doc(db, 'drivers', driverId), {
    driverPhotoCandidateOriginalPath: originalPath,
    driverPhotoCandidatePublicPath: publicCandidatePath,
    driverPhotoCandidateVersion: version,
    driverPhotoReviewStatus: 'pending',
    driverPhotoSubmittedAt: serverTimestamp(),
    driverPhotoRejectionCode: null,
    driverPhotoRejectionReason: null,
    selfieStatus: 'submitted',
    updatedAt: serverTimestamp(),
  });

  logDriverPhotoEvent('candidate.submit_succeeded', {
    driverId,
    version,
    status: 'pending',
    durationMs: Date.now() - startedAt,
  });
}

function isPublicPhotoPath(path) {
  return typeof path === 'string' && /^publicDriverPhotos\/[^/]+\/[^/]+\.jpg$/.test(path);
}

function isPrivatePhotoCandidatePath(path) {
  return typeof path === 'string'
    && /^drivers\/[^/]+\/profile-photo\/[^/]+\/(original|public-candidate)\.jpg$/.test(path);
}

export async function getDriverPhotoDownloadUrl(path, { allowPrivateCandidate = false } = {}) {
  if (!isPublicPhotoPath(path) && !(allowPrivateCandidate && isPrivatePhotoCandidatePath(path))) {
    throw new Error('Caminho de foto inválido.');
  }
  // Storage Rules remain authoritative. Private candidates are readable only by
  // the owner/admin; the approved public copy is readable by authenticated users.
  return getDownloadURL(ref(storage, path));
}
