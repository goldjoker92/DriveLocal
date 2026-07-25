// @ts-check
// Launch duplicate detection for driver approval. Raw values are normalized only
// in server memory, never returned, logged or copied into risk collections.
// The scan is bounded for the Horizonte pilot and fails closed if the cap is hit.

const riskC = require('../risk/constants');

const DRIVER_SCAN_LIMIT = 1501;
const MAX_SUPPORTED_DRIVERS = 1500;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function compactUpper(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function compactLower(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizedKeys(driver = {}) {
  return {
    cpf: digits(driver.cpf),
    plate: compactUpper(driver.vehiclePlate || driver.plate),
    pix: compactLower(driver.pixKey),
    phone: digits(driver.whatsApp || driver.phone),
    email: compactLower(driver.email),
  };
}

const CHECKS = Object.freeze([
  { field: 'cpf', reasonCode: riskC.REASON.DUPLICATE_CPF, hard: true, minLength: 11 },
  { field: 'plate', reasonCode: riskC.REASON.DUPLICATE_VEHICLE_PLATE, hard: false, minLength: 7 },
  { field: 'pix', reasonCode: riskC.REASON.DUPLICATE_PIX_KEY, hard: false, minLength: 5 },
  { field: 'phone', reasonCode: riskC.REASON.DUPLICATE_PHONE, hard: false, minLength: 10 },
  { field: 'email', reasonCode: riskC.REASON.DUPLICATE_EMAIL, hard: false, minLength: 5 },
]);

function findDuplicateConflicts(targetId, target, drivers = []) {
  const targetKeys = normalizedKeys(target);
  const conflicts = [];

  CHECKS.forEach((check) => {
    const value = targetKeys[check.field];
    if (!value || value.length < check.minLength) return;
    const matchingDriverIds = drivers
      .filter((entry) => entry.driverId !== targetId)
      .filter((entry) => {
        const status = entry.data?.verificationStatus;
        return status !== 'rejected' && status !== 'draft';
      })
      .filter((entry) => normalizedKeys(entry.data)[check.field] === value)
      .map((entry) => entry.driverId)
      .slice(0, 10);

    if (matchingDriverIds.length > 0) {
      conflicts.push({
        field: check.field,
        reasonCode: check.reasonCode,
        hard: check.hard,
        matchingDriverIds,
      });
    }
  });
  return conflicts;
}

async function scanDriverDuplicates(db, driverId, driverData) {
  const snapshot = await db.collection('drivers').limit(DRIVER_SCAN_LIMIT).get();
  if (snapshot.size > MAX_SUPPORTED_DRIVERS) {
    const error = new Error('driver duplicate scan reached launch safety cap');
    error.code = 'DUPLICATE_SCAN_LIMIT_REACHED';
    throw error;
  }
  const drivers = snapshot.docs.map((document) => ({
    driverId: document.id,
    data: document.data() || {},
  }));
  return {
    scannedCount: snapshot.size,
    conflicts: findDuplicateConflicts(driverId, driverData, drivers),
  };
}

module.exports = {
  DRIVER_SCAN_LIMIT,
  MAX_SUPPORTED_DRIVERS,
  CHECKS,
  digits,
  compactUpper,
  compactLower,
  normalizedKeys,
  findDuplicateConflicts,
  scanDriverDuplicates,
};
