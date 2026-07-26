'use strict';

// Builds the only passenger identity projection a driver may receive after
// accepting a ride. The source passengers/{uid} document remains private.

const DEFAULT_FIRST_NAME = 'Passageiro';
const MAX_FIRST_NAME_LENGTH = 40;
const PUBLIC_PHOTO_VERSION_PATTERN = /^[A-Za-z0-9_-]{12,80}$/;
const PUBLIC_PHOTO_PATH_PATTERN = /^publicPassengerPhotos\/[A-Za-z0-9_-]{12,80}\.jpg$/;

function normalizeText(value) {
  if (value == null) return '';
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function sanitizeFirstToken(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.includes('@')) return '';

  const token = normalized.split(' ')[0]
    .replace(/[^\p{L}\p{M}'’-]/gu, '')
    .replace(/^['’\-]+|['’\-]+$/g, '')
    .slice(0, MAX_FIRST_NAME_LENGTH);

  return /\p{L}/u.test(token) ? token : '';
}

function passengerFirstName(passenger) {
  const preferred = sanitizeFirstToken(passenger?.publicFirstName || passenger?.firstName);
  if (preferred) return preferred;
  const fromFullName = sanitizeFirstToken(passenger?.fullName || passenger?.displayName);
  return fromFullName || DEFAULT_FIRST_NAME;
}

function isPublicPassengerPhotoPath(path) {
  return typeof path === 'string' && PUBLIC_PHOTO_PATH_PATTERN.test(path);
}

// The public object id is opaque and globally unique. It never contains the
// passenger Firebase uid, email, phone or another account-derived identifier.
function approvedPassengerPhotoPath(passenger) {
  const verified = passenger?.passengerPhotoPublicVerified === true;
  const version = normalizeText(passenger?.passengerPhotoPublicVersion);
  const path = normalizeText(passenger?.passengerPhotoPublicPath);
  if (!verified || !PUBLIC_PHOTO_VERSION_PATTERN.test(version)) return null;

  const expected = `publicPassengerPhotos/${version}.jpg`;
  return path === expected && isPublicPassengerPhotoPath(path) ? expected : null;
}

function buildAcceptedPassengerPublic(passenger) {
  const photoStoragePath = approvedPassengerPhotoPath(passenger);
  return Object.freeze({
    firstName: passengerFirstName(passenger),
    photoStoragePath,
    photoVerified: Boolean(photoStoragePath),
  });
}

module.exports = {
  DEFAULT_FIRST_NAME,
  MAX_FIRST_NAME_LENGTH,
  passengerFirstName,
  isPublicPassengerPhotoPath,
  approvedPassengerPhotoPath,
  buildAcceptedPassengerPublic,
};
