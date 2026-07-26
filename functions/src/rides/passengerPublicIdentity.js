'use strict';

// Builds the only passenger identity projection a driver may receive after
// accepting a ride. The source passengers/{uid} document remains private.

const DEFAULT_FIRST_NAME = 'Passageiro';
const MAX_FIRST_NAME_LENGTH = 40;
const PUBLIC_PHOTO_VERSION_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

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

// A profile path is accepted only when a backend/admin-approved version points to
// its canonical immutable object. Client-controlled generic URLs are ignored.
function approvedPassengerPhotoPath(passenger, passengerId) {
  const verified = passenger?.passengerPhotoPublicVerified === true;
  const version = normalizeText(passenger?.passengerPhotoPublicVersion);
  const path = normalizeText(passenger?.passengerPhotoPublicPath);
  if (!verified || !passengerId || !PUBLIC_PHOTO_VERSION_PATTERN.test(version)) return null;

  const expected = `publicPassengerPhotos/${passengerId}/${version}.jpg`;
  return path === expected ? expected : null;
}

function buildAcceptedPassengerPublic(passenger, passengerId) {
  const photoStoragePath = approvedPassengerPhotoPath(passenger, passengerId);
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
  approvedPassengerPhotoPath,
  buildAcceptedPassengerPublic,
};
