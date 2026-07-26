// @ts-check
// Pure account-deletion policy. No Firebase imports: deterministic and testable.

const { randomUUID } = require('crypto');

const POLICY_VERSION = 'account-deletion-2026.1';
const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
const CONFIRMATION_TEXT = 'EXCLUIR';
const ACCOUNT_DELETION_REQUESTS = 'accountDeletionRequests';
const ACCOUNT_DELETION_AUDITS = 'accountDeletionAudits';

function normalizeRole(value) {
  return value === 'driver' || value === 'passenger' ? value : null;
}

function assertConfirmation(value) {
  return String(value || '').trim().toUpperCase() === CONFIRMATION_TEXT;
}

function authAgeMs(authToken, nowMs) {
  const authTimeSeconds = Number(authToken?.auth_time || 0);
  if (!(authTimeSeconds > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Number(nowMs) - authTimeSeconds * 1000);
}

function recentAuthentication(authToken, nowMs) {
  return authAgeMs(authToken, nowMs) <= RECENT_AUTH_MAX_AGE_MS;
}

function createAnonymousSubjectId(role, uuidFactory = randomUUID) {
  const normalizedRole = normalizeRole(role) || 'user';
  return `deleted_${normalizedRole}_${String(uuidFactory()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 36)}`;
}

function deletedDriverPublic(previous = {}) {
  return {
    name: 'Motorista excluído',
    vehicleType: previous?.vehicleType === 'moto' ? 'moto' : 'car',
    vehicleMake: '',
    vehicleModel: '',
    vehicleColor: '',
    vehiclePlate: '—',
    photoStoragePath: null,
    photoVerified: false,
  };
}

function deletedPassengerPublic() {
  return {
    firstName: 'Passageiro excluído',
    photoStoragePath: null,
    photoVerified: false,
  };
}

function removedRoutePoint() {
  return { label: 'Local removido' };
}

function buildRideAnonymizationUpdate({ role, anonymousSubjectId, ride = {}, deleteField }) {
  const update = {
    accountDeletionPolicyVersion: POLICY_VERSION,
    accountDeletedRole: role,
    accountDeletedAt: 'SERVER_TIMESTAMP',
    pickup: removedRoutePoint(),
    destination: removedRoutePoint(),
  };

  if (role === 'passenger') {
    update.passengerId = anonymousSubjectId;
    update.passengerDeleted = true;
    update.acceptedPassengerPublic = deletedPassengerPublic();
  } else if (role === 'driver') {
    update.acceptedDriverId = anonymousSubjectId;
    update.driverDeleted = true;
    update.acceptedDriverPublic = deletedDriverPublic(ride.acceptedDriverPublic);
    if (ride.driverId != null) update.driverId = anonymousSubjectId;
    if (ride.assignedDriverId != null) update.assignedDriverId = anonymousSubjectId;
    if (ride.acceptedAvailabilitySessionId != null) {
      update.acceptedAvailabilitySessionId = deleteField;
    }
  }

  // Exact or provider-facing route/payment details are never required in the
  // passenger/driver history once the related account is deleted.
  for (const field of [
    'pickupPreview',
    'exactPickup',
    'exactDestination',
    'passengerPhone',
    'driverPhone',
    'passengerPixKey',
    'driverPixKey',
  ]) {
    if (Object.prototype.hasOwnProperty.call(ride, field)) update[field] = deleteField;
  }

  return update;
}

function buildFinancialPseudonymizationUpdate({ anonymousSubjectId, deleteField }) {
  return {
    driverId: anonymousSubjectId,
    accountDeleted: true,
    accountDeletionPolicyVersion: POLICY_VERSION,
    qrCode: deleteField,
    qrCodeBase64: deleteField,
    idempotencyKey: deleteField,
    idempotencyFingerprint: deleteField,
    updatedAt: 'SERVER_TIMESTAMP',
  };
}

module.exports = {
  POLICY_VERSION,
  RECENT_AUTH_MAX_AGE_MS,
  CONFIRMATION_TEXT,
  ACCOUNT_DELETION_REQUESTS,
  ACCOUNT_DELETION_AUDITS,
  normalizeRole,
  assertConfirmation,
  authAgeMs,
  recentAuthentication,
  createAnonymousSubjectId,
  buildRideAnonymizationUpdate,
  buildFinancialPseudonymizationUpdate,
};
