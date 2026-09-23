// Mobile display mirror of the backend policy. Dispatch and wallet settlement
// remain authoritative on the server, regardless of stale profile fields.
import { COMMISSION_FREE_DAYS, getVehiclePricing } from '../constants/pricingConfig';

export const COMMERCIAL_POLICY_VERSION = 'commercial-policy-v3-2026-09';
export const DAY_MS = 24 * 60 * 60 * 1000;

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return toMillis(value.toDate());
  if (Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  return 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function isFounderDriver(driver = {}) {
  const number = positiveInteger(driver.approvalNumber);
  if (number > 0) return number <= 100;
  return driver.founderEligible === true && positiveInteger(driver.founderNumber) <= 100;
}

export function approvalTimeMs(driver = {}) {
  return toMillis(driver.approvedAtMs) || toMillis(driver.approvedAt);
}

export function freePeriodUntilMs(driver = {}) {
  const approvedAtMs = approvalTimeMs(driver);
  if (approvedAtMs > 0) return approvedAtMs + COMMISSION_FREE_DAYS * DAY_MS;
  return toMillis(driver.commissionFreeUntil);
}

export function resolveCommercialPolicy(driver = {}, nowValue = Date.now()) {
  const nowMs = toMillis(nowValue) || Number(nowValue) || Date.now();
  const freeUntilMs = freePeriodUntilMs(driver);
  const freePeriodActive = driver.verificationStatus === 'approved' && freeUntilMs > nowMs;
  const vehicleType = ['moto', 'car'].includes(driver.vehicleType) ? driver.vehicleType : null;
  const standardCommissionBps = Number(
    getVehiclePricing(driver.serviceAreaId, vehicleType)?.normalCommissionBps || 0
  );
  const commissionBps = freePeriodActive ? 0 : standardCommissionBps;
  return Object.freeze({
    policyVersion: COMMERCIAL_POLICY_VERSION,
    founder: isFounderDriver(driver),
    vehicleType,
    freePeriodUntilMs: freeUntilMs,
    freePeriodActive,
    standardCommissionBps,
    commissionBps,
    commissionPercent: commissionBps / 100,
    walletTopupRequired: !freePeriodActive,
  });
}
