import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { storage } from '../config/firebase';
import {
  publicDriverPhotoCrop,
  publicDriverPhotoSize,
  validateDriverPhotoAsset,
} from '../utils/driverPhoto';
import { logDriverPhotoEvent } from '../utils/driverPhotoLog';

const NS = '[STORAGE]';
const MAX_WIDTH = 1200;
const COMPRESS_QUALITY = 0.7;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const DRIVER_PHOTO_ORIGINAL_MAX_WIDTH = 1600;
const DRIVER_PHOTO_ORIGINAL_QUALITY = 0.82;
const DRIVER_PHOTO_PUBLIC_QUALITY = 0.78;

const DRIVER_DOCS = Object.freeze({
  selfie: 'selfie', // Legacy key kept for old records; new profile photos use the dedicated flow.
  cnh_frente: 'cnh_frente',
  cnh_verso: 'cnh_verso',
  crlv: 'crlv',
  vehicle_photo: 'vehicle_photo',
  motofrete_cert: 'motofrete_cert',
});

export { DRIVER_DOCS };

async function logFileSize(uri, label) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info && info.size) console.log(NS, `${label} size KB:`, Math.round(info.size / 1024));
    return Number(info?.size || 0);
  } catch (error) {
    console.log(NS, `${label} size unknown:`, error?.message || 'unknown');
    return 0;
  }
}

async function assertFileSize(uri) {
  const size = await logFileSize(uri, 'prepared');
  if (size > MAX_SIZE_BYTES) throw new Error('Arquivo muito grande (máx. 5 MB).');
}

export async function compressImage(uri) {
  console.log(NS, 'compressing image...');
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_WIDTH, height: null });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: COMPRESS_QUALITY,
  });
  await logFileSize(result.uri, 'compressed');
  return result.uri;
}

export function uriToBlob_XHR(uri) {
  console.log(NS, 'uri -> blob via XHR');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('uriToBlob_XHR failed'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

async function uploadPreparedImage({ path, uri, contentType = 'image/jpeg', onProgress }) {
  await assertFileSize(uri);
  const blob = await uriToBlob_XHR(uri);
  const storageRef = ref(storage, path);
  try {
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, blob, {
        contentType,
        cacheControl: 'private,max-age=0,no-store',
      });
      task.on(
        'state_changed',
        (snapshot) => {
          const pct = snapshot.totalBytes
            ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
            : 0;
          if (typeof onProgress === 'function') onProgress(pct);
        },
        reject,
        resolve
      );
    });
  } finally {
    if (blob && typeof blob.close === 'function') blob.close();
  }
}

export async function uploadDriverDocument({ driverId, docType, uri, mime, onProgress }) {
  if (!driverId) throw new Error('uploadDriverDocument: driverId manquant');
  if (!DRIVER_DOCS[docType]) throw new Error(`uploadDriverDocument: docType inválido (${docType})`);
  if (!uri) throw new Error('uploadDriverDocument: uri manquant');
  if (Platform.OS === 'web') throw new Error('Upload indisponível na web — use o dev build Android.');

  console.log(NS, `uploadDriverDocument start docType=${docType} driverId=${driverId}`);
  const contentType = mime || 'image/jpeg';
  const path = `drivers/${driverId}/${docType}.jpg`;
  const compressedUri = await compressImage(uri);
  await uploadPreparedImage({ path, uri: compressedUri, contentType, onProgress });

  const storageRef = ref(storage, path);
  const url = await getDownloadURL(storageRef);
  // Never print the tokenized download URL in logs.
  console.log(NS, `uploadDriverDocument success docType=${docType}`);
  return { url, path, contentType };
}

// Generates both private review source and the exact square passenger image.
// Saving as JPEG strips camera metadata from the public candidate.
export async function prepareDriverPhotoVariants(asset) {
  const validation = validateDriverPhotoAsset(asset);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.code = validation.code;
    throw error;
  }

  const startedAt = Date.now();
  const originalContext = ImageManipulator.manipulate(asset.uri);
  originalContext.resize({
    width: Math.min(validation.width, DRIVER_PHOTO_ORIGINAL_MAX_WIDTH),
    height: null,
  });
  const originalRendered = await originalContext.renderAsync();
  const original = await originalRendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: DRIVER_PHOTO_ORIGINAL_QUALITY,
  });

  const publicSize = publicDriverPhotoSize();
  const publicContext = ImageManipulator.manipulate(asset.uri);
  publicContext.crop(publicDriverPhotoCrop(asset));
  publicContext.resize({ width: publicSize, height: publicSize });
  const publicRendered = await publicContext.renderAsync();
  const publicCandidate = await publicRendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: DRIVER_PHOTO_PUBLIC_QUALITY,
  });

  await Promise.all([
    assertFileSize(original.uri),
    assertFileSize(publicCandidate.uri),
  ]);

  logDriverPhotoEvent('variants.prepared', {
    stage: 'prepare',
    width: validation.width,
    height: validation.height,
    durationMs: Date.now() - startedAt,
  });

  return {
    originalUri: original.uri,
    publicCandidateUri: publicCandidate.uri,
    publicCrop: publicDriverPhotoCrop(asset),
  };
}

export async function uploadDriverPhotoCandidate({
  driverId,
  version,
  asset,
  preparedVariants,
  onProgress,
}) {
  if (!driverId) throw new Error('uploadDriverPhotoCandidate: driverId manquant');
  if (!version) throw new Error('uploadDriverPhotoCandidate: version manquante');
  if (Platform.OS === 'web') throw new Error('A foto do motorista deve ser enviada pelo app Android.');

  const startedAt = Date.now();
  logDriverPhotoEvent('upload.started', {
    driverId,
    version,
    stage: preparedVariants ? 'reuse_preview' : 'prepare',
  });

  // Reuse the exact preview the driver accepted. This avoids a second crop and
  // guarantees that the uploaded public candidate matches the UI preview.
  const variants = preparedVariants || await prepareDriverPhotoVariants(asset);
  if (!variants?.originalUri || !variants?.publicCandidateUri) {
    throw new Error('Variantes da foto indisponíveis. Tire a foto novamente.');
  }

  const base = `drivers/${driverId}/profile-photo/${version}`;
  const originalPath = `${base}/original.jpg`;
  const publicCandidatePath = `${base}/public-candidate.jpg`;

  await uploadPreparedImage({
    path: originalPath,
    uri: variants.originalUri,
    onProgress: (pct) => {
      const progress = Math.round(pct * 0.55);
      logDriverPhotoEvent('upload.progress', { driverId, version, stage: 'original', progress });
      if (typeof onProgress === 'function') onProgress(progress);
    },
  });

  await uploadPreparedImage({
    path: publicCandidatePath,
    uri: variants.publicCandidateUri,
    onProgress: (pct) => {
      const progress = 55 + Math.round(pct * 0.45);
      logDriverPhotoEvent('upload.progress', { driverId, version, stage: 'public_candidate', progress });
      if (typeof onProgress === 'function') onProgress(progress);
    },
  });

  logDriverPhotoEvent('upload.succeeded', {
    driverId,
    version,
    stage: 'complete',
    progress: 100,
    durationMs: Date.now() - startedAt,
  });

  return { originalPath, publicCandidatePath, version };
}
