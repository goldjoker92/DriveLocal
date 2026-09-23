'use strict';
// One server-owned commercial rule. Historical plan and five-ride fields are
// intentionally ignored. The approval timestamp is the only promotion anchor.
const C = require('./constants');
const { getVehiclePricing } = require('../pricing/pricing');

const COMMERCIAL_POLICY_VERSION = 'commercial-policy-v3-2026-09';

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
    if (typeof value.toDate === 'function') return toMillis(value.toDate());
    if (Number.isFinite(value.seconds)) {
      return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
    }
  }
  return 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function isFounderDriver(driver = {}) {
  const number = positiveInteger(driver.approvalNumber);
  if (number > 0) return number <= C.FOUNDER_LIMIT;
  // Older approved profiles can predate approvalNumber. Keep their badge if
  // it was granted, without creating any extra commission entitlement.
  return driver.founderEligible === true
    && positiveInteger(driver.founderNumber) <= C.FOUNDER_LIMIT;
}

function approvalTimeMs(driver = {}) {
  return toMillis(driver.approvedAtMs) || toMillis(driver.approvedAt);
}

function freePeriodUntilMs(driver = {}) {
  const approvedAtMs = approvalTimeMs(driver);
  if (approvedAtMs > 0) return approvedAtMs + C.FREE_PERIOD_DAYS * C.DAY_MS;
  // Historical approved records may only have this fixed server-issued date.
  return toMillis(driver.commissionFreeUntil);
}

function standardCommissionBps(driver = {}) {
  if (!['moto', 'car'].includes(driver.vehicleType)) return 0;
  return Number(getVehiclePricing(driver.serviceAreaId, driver.vehicleType)?.normalCommissionBps || 0);
}

function resolveCommercialPolicy(driver = {}, nowValue = Date.now()) {
  const nowMs = toMillis(nowValue) || Number(nowValue) || Date.now();
  const freeUntilMs = freePeriodUntilMs(driver);
  const freePeriodActive = driver.verificationStatus === 'approved' && freeUntilMs > nowMs;
  const standardBps = standardCommissionBps(driver);
  const commissionBps = freePeriodActive ? 0 : standardBps;
  return Object.freeze({
    policyVersion: COMMERCIAL_POLICY_VERSION,
    approvalNumber: positiveInteger(driver.approvalNumber) || null,
    founder: isFounderDriver(driver),
    vehicleType: ['moto', 'car'].includes(driver.vehicleType) ? driver.vehicleType : null,
    freePeriodUntilMs: freeUntilMs,
    freePeriodActive,
    standardCommissionBps: standardBps,
    commissionBps,
    commissionPercent: commissionBps / 100,
    walletTopupRequired: !freePeriodActive,
  });
}

function buildCommercialPolicySnapshot(driver = {}, nowValue = Date.now()) {
  const policy = resolveCommercialPolicy(driver, nowValue);
  return Object.freeze({
    policyVersion: policy.policyVersion,
    acceptedAtMs: toMillis(nowValue) || Number(nowValue),
    approvalNumber: policy.approvalNumber,
    founder: policy.founder,
    vehicleType: policy.vehicleType,
    freePeriodUntilMs: policy.freePeriodUntilMs,
    commissionBpsAtAcceptance: policy.commissionBps,
    commissionFreeAtAcceptance: policy.freePeriodActive,
  });
}

module.exports = {
  COMMERCIAL_POLICY_VERSION, toMillis, isFounderDriver, approvalTimeMs,
  freePeriodUntilMs, standardCommissionBps, resolveCommercialPolicy,
  buildCommercialPolicySnapshot,
};
