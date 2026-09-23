// Driver ride-eligibility helper (DriveLocal V1).
//
// Pure function over an already-loaded drivers/{uid} object + a ride request.
// No Firestore here. The backend remains authoritative; this helper prevents the
// cockpit and offer UI from presenting an action that is already known to fail.

import { calculateCommissionBps } from './ridePricing';
import { MIN_WALLET_BALANCE_CENTAVOS } from '../constants/pricingConfig';

// Rejection reason codes (stable strings — safe to switch on / log).
export const RIDE_ELIGIBILITY_REASON = {
  OK: 'OK',
  NOT_APPROVED: 'NOT_APPROVED',
  DRIVER_BLOCKED: 'DRIVER_BLOCKED',
  VEHICLE_TYPE_MISMATCH: 'VEHICLE_TYPE_MISMATCH',
  WALLET_BALANCE_TOO_LOW: 'WALLET_BALANCE_TOO_LOW',
};

function isBlockedDriver(driver) {
  const d = driver || {};
  return d.isBlocked === true || d.verificationStatus === 'suspended';
}

export function canDriverReceiveRide(driver, rideRequest, now = Date.now()) {
  const d = driver || {};
  const req = rideRequest || {};

  if (d.verificationStatus !== 'approved') {
    return reject(RIDE_ELIGIBILITY_REASON.NOT_APPROVED);
  }
  if (isBlockedDriver(d)) {
    return reject(RIDE_ELIGIBILITY_REASON.DRIVER_BLOCKED);
  }
  if (req.vehicleType && d.vehicleType && req.vehicleType !== d.vehicleType) {
    return reject(RIDE_ELIGIBILITY_REASON.VEHICLE_TYPE_MISMATCH);
  }
  // Wallet is a blocker only when commission can actually apply to this ride.
  const commissionBps = calculateCommissionBps(req.vehicleType, req.distanceKm, d, now);
  if (commissionBps > 0) {
    const balance = Number(d.walletBalanceCentavos) || 0;
    if (balance < MIN_WALLET_BALANCE_CENTAVOS) {
      return reject(RIDE_ELIGIBILITY_REASON.WALLET_BALANCE_TOO_LOW);
    }
  }

  return { eligible: true, reason: RIDE_ELIGIBILITY_REASON.OK };
}

function reject(reason) {
  console.log('[DRIVER_COMMERCIAL_POLICY] eligibility_rejected', {
    scope: 'driver_commercial_policy',
    event: 'eligibility_rejected',
    reasonCode: reason,
    atMs: Date.now(),
  });
  return { eligible: false, reason };
}
