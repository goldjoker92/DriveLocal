// ============================================================
// Storage service DriveLocal — Iteration 1B
// Basé sur uploadCore.native.js de VigiApp
// Upload via @react-native-firebase/storage putFile()
// Zéro blob, zéro fetch() — putFile() accepte file:// et content://
// Fallback content:// -> cache file:// via expo-file-system (legacy)
// IMPORTANT: actif uniquement après dev build Android
// // TODO: ce service nécessite @react-native-firebase et un dev build Android
// // Sur web il échouera — prévu, l'upload réel se teste uniquement sur Android
// ============================================================

import { getApp } from '@react-native-firebase/app';
import storage from '@react-native-firebase/storage';
// SDK 56 : l'API legacy (cacheDirectory/copyAsync/getInfoAsync) vit sous
// 'expo-file-system/legacy' — l'entrée principale lèverait une erreur runtime.
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

// Constantes
const NS = '[STORAGE]';
const MAX_WIDTH = 1200;
const COMPRESS_QUALITY = 0.7;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 Mo

// Documents DriveLocal autorisés
const DRIVER_DOCS = Object.freeze({
  selfie: 'selfie',
  cnh_frente: 'cnh_frente',
  cnh_verso: 'cnh_verso',
  crlv: 'crlv',
  vehicle_photo: 'vehicle_photo',
  motofrete_cert: 'motofrete_cert',
});

export { DRIVER_DOCS };

// Compresse et redimensionne une image en JPEG (API contextuelle SDK 56).
// Retourne l'URI de l'image compressée.
export async function compressImage(uri) {
  console.log(NS, 'compressing image...');
  // API objet : manipulate -> resize -> renderAsync -> saveAsync.
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_WIDTH, height: null });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: COMPRESS_QUALITY,
  });

  // Log de la taille compressée si disponible.
  try {
    const info = await FileSystem.getInfoAsync(result.uri);
    if (info && info.size) {
      console.log(NS, 'compressed size KB:', Math.round(info.size / 1024));
    }
  } catch (e) {
    console.log(NS, 'compressed size unknown:', e.message);
  }

  return result.uri;
}

// Fallback UNIQUEMENT pour un content:// non résolu : lit l'URI via XHR -> blob.
// (Pattern hérité de VigiApp ; rarement nécessaire avec putFile.)
export function uriToBlob_XHR(uri) {
  console.log(NS, 'XHR blob fallback for content://');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response);
    xhr.onerror = () => reject(new Error('uriToBlob_XHR failed'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

// Copie un content:// vers le cache en file:// (identique à VigiApp).
// Retourne le nouvel URI file://.
export async function materializeContentUri(uri, ext) {
  console.log(NS, 'materializing content:// -> file://');
  const safeExt = ext || 'jpg';
  const target = `${FileSystem.cacheDirectory}dl_upload_${Date.now()}.${safeExt}`;
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
}

// Upload d'un document chauffeur vers Firebase Storage.
// { driverId, docType, uri, mime, onProgress } -> { url, path, contentType }
export async function uploadDriverDocument({ driverId, docType, uri, mime, onProgress }) {
  // Validation des entrées.
  if (!driverId) throw new Error('uploadDriverDocument: driverId manquant');
  if (!DRIVER_DOCS[docType]) throw new Error(`uploadDriverDocument: docType inválido (${docType})`);
  if (!uri) throw new Error('uploadDriverDocument: uri manquant');

  // Garde web : l'upload réel n'existe que sur le dev build Android.
  if (Platform.OS === 'web') {
    throw new Error('Upload indisponível na web — use o dev build Android.');
  }

  console.log(NS, `uploadDriverDocument start docType=${docType} driverId=${driverId}`);

  const contentType = mime || 'image/jpeg';
  const path = `drivers/${driverId}/${docType}.jpg`;

  // 1. Compresse l'image avant l'upload.
  const compressedUri = await compressImage(uri);

  // Garde de taille : refuse les fichiers > 5 Mo (aligné avec storage.rules).
  try {
    const info = await FileSystem.getInfoAsync(compressedUri);
    if (info && info.size && info.size > MAX_SIZE_BYTES) {
      throw new Error('Arquivo muito grande (máx. 5 MB).');
    }
  } catch (e) {
    if (e && e.message && e.message.indexOf('5 MB') !== -1) throw e;
    console.log(NS, 'size check skipped:', e.message);
  }

  // Référence Storage (app par défaut).
  const ref = storage(getApp()).ref(path);

  // Lance l'upload et suit la progression.
  async function runPutFile(localUri) {
    const task = ref.putFile(localUri, { contentType });
    // 4. Progression via state_changed.
    task.on('state_changed', (snapshot) => {
      const pct = snapshot.totalBytes
        ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
        : 0;
      console.log(NS, `progress ${pct}% docType=${docType}`);
      if (typeof onProgress === 'function') onProgress(pct);
    });
    await task;
  }

  try {
    // 2. Tente putFile() direct (file:// ou content://).
    await runPutFile(compressedUri);
  } catch (err) {
    // 3. Si content:// échoue -> materialize -> putFile().
    if (typeof compressedUri === 'string' && compressedUri.startsWith('content://')) {
      console.log(NS, 'direct putFile failed for content:// — materializing', err.message);
      const fileUri = await materializeContentUri(compressedUri, 'jpg');
      await runPutFile(fileUri);
    } else {
      throw err;
    }
  }

  // 5. URL de téléchargement après succès.
  const url = await ref.getDownloadURL();
  console.log(NS, `uploadDriverDocument success url=${url}`);

  return { url, path, contentType };
}
