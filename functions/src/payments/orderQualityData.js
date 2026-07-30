// @ts-check
// Mercado Pago order enrichment for the driver -> DriveLocal payment flow.
//
// This module is intentionally pure and provider-agnostic. It converts the
// server-authoritative driver profile into the minimum useful payer/item fields
// expected by Mercado Pago without leaking PII into logs, metadata or external
// references. Passenger data must never enter this flow.

const { AppError, ERROR_CODES } = require('../errors/appError');

const ITEM_CATEGORY_ID = 'services';
const DEVICE_SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/;

function compactString(value, maxLength = 255) {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/\s+/g, ' ');
  if (!compact) return null;
  return compact.slice(0, maxLength);
}

function normalizeEmail(value) {
  const email = compactString(value, 254);
  if (!email) return null;
  // Deliberately small boundary check. Firebase Auth remains the source of truth;
  // Mercado Pago performs the final provider-side validation.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email.toLowerCase();
}

function cpfCheckDigit(baseDigits, factor) {
  let sum = 0;
  for (const digit of baseDigits) {
    sum += Number(digit) * factor;
    factor -= 1;
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

function normalizeCpf(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return null;

  const first = cpfCheckDigit(digits.slice(0, 9), 10);
  const second = cpfCheckDigit(digits.slice(0, 10), 11);
  if (first !== Number(digits[9]) || second !== Number(digits[10])) return null;
  return digits;
}

function splitFullName(value) {
  const fullName = compactString(value, 120);
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function timestampToIso(value) {
  if (value == null) return null;
  let date = null;

  if (value && typeof value.toDate === 'function') {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number' || typeof value === 'string') {
    date = new Date(value);
  } else if (value && Number.isFinite(value._seconds)) {
    date = new Date(Number(value._seconds) * 1000);
  }

  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Builds Mercado Pago payer data from the authenticated driver's own profile.
 * CPF is optional and included only when its format and checksum are valid.
 * @param {{driver?:object, authToken?:object}} input
 */
function buildDriverPayer(input = {}) {
  const driver = input.driver || {};
  const authToken = input.authToken || {};
  const email = normalizeEmail(driver.email) || normalizeEmail(authToken.email);
  if (!email) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'driver payment requires a valid authenticated email',
      safeMetadata: { field: 'email' },
    });
  }

  const payer = { email };
  const { firstName, lastName } = splitFullName(driver.fullName || driver.displayName);
  if (firstName) payer.first_name = firstName;
  if (lastName) payer.last_name = lastName;

  const cpf = normalizeCpf(driver.cpf);
  if (cpf) payer.identification = { type: 'CPF', number: cpf };
  return payer;
}

/**
 * One digital item represents one wallet top-up or subscription purchase.
 * @param {{purpose:string, vehicleType?:string, amountCentavos:number}} input
 */
function buildOrderItem(input) {
  const amountCentavos = Number(input && input.amountCentavos);
  if (!Number.isInteger(amountCentavos) || amountCentavos <= 0) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'order item requires a positive integer amountCentavos',
      safeMetadata: { field: 'amountCentavos' },
    });
  }

  const purpose = input && input.purpose;
  const vehicleType = input && input.vehicleType;
  let title;
  let description;
  let externalCode;

  if (purpose === 'driver_subscription') {
    const vehicleLabel = vehicleType === 'moto' ? 'Moto' : vehicleType === 'car' ? 'Carro' : null;
    title = vehicleLabel ? `Assinatura DriveLocal ${vehicleLabel}` : 'Assinatura DriveLocal';
    description = 'Assinatura mensal do motorista parceiro DriveLocal';
    externalCode = vehicleType === 'moto'
      ? 'driver_subscription_moto'
      : vehicleType === 'car'
        ? 'driver_subscription_car'
        : 'driver_subscription';
  } else if (purpose === 'wallet_topup') {
    title = 'Recarga Saldo DriveLocal';
    description = 'Recarga digital do saldo operacional do motorista parceiro';
    externalCode = 'driver_wallet_topup';
  } else {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `unsupported Mercado Pago item purpose: ${purpose}`,
      safeMetadata: { field: 'purpose' },
    });
  }

  return {
    title,
    description,
    category_id: ITEM_CATEGORY_ID,
    quantity: 1,
    unit_price: (amountCentavos / 100).toFixed(2),
    external_code: externalCode,
  };
}

function buildAdditionalInfo(driver = {}) {
  const registrationDate = timestampToIso(driver.createdAt || driver.createdAtMs);
  if (!registrationDate) return null;
  return { payer: { registration_date: registrationDate } };
}

/**
 * The value must come from Mercado Pago's official security tooling.
 * Never replace it with Firebase UID, Android ID, IMEI or an app-generated UUID.
 */
function normalizeDeviceSessionId(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !DEVICE_SESSION_ID_PATTERN.test(value)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'invalid Mercado Pago device session id',
      safeMetadata: { field: 'deviceSessionId' },
    });
  }
  return value;
}

module.exports = {
  ITEM_CATEGORY_ID,
  normalizeEmail,
  normalizeCpf,
  splitFullName,
  timestampToIso,
  buildDriverPayer,
  buildOrderItem,
  buildAdditionalInfo,
  normalizeDeviceSessionId,
};
