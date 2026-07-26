import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../config/firebase';

const PUBLIC_PASSENGER_PHOTO_PATTERN = /^publicPassengerPhotos\/[A-Za-z0-9_-]{12,80}\.jpg$/;

export function isAcceptedPassengerPhotoPath(path) {
  return typeof path === 'string' && PUBLIC_PASSENGER_PHOTO_PATTERN.test(path);
}

export async function getAcceptedPassengerPhotoDownloadUrl(path) {
  if (!isAcceptedPassengerPhotoPath(path)) {
    const error = new Error('Caminho de foto pública do passageiro inválido.');
    error.code = 'passenger-photo/invalid-public-path';
    throw error;
  }
  return getDownloadURL(ref(storage, path));
}
