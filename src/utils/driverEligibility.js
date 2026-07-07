// Driver ride-eligibility helper (DriveLocal V1).
//
// Pure function over an already-loaded drivers/{uid} object + a ride request.
// No Firestore here. Decides whether a driver may RECEIVE a given ride request.
//
// This complements utils/driverCockpit.js deriveEligibility (which answers the
// simpler "can this driver go available?" for the cockpit). canDriverReceiveRide
// is per-ride: it also checks the vehicle type match and the wallet balance when
// commission may apply to THIS ride.

import { calculateCommissionBps } from './ridePricing';
import { getEffectiveSubscriptionStatus } from './driverSubscription';
import {
  MIN_WALLET_BALANCE_CENTAVOS,
  NON_FOUNDER_FREE_RIDES,
} from '../constants/pricingConfig';

// Rejection reason codes (stable strings — safe to switch on / log).
export const RIDE_ELIGIBILITY_REASON = {
  OK: 'OK',
  NOT_APPROVED: 'NOT_APPROVED',
  DRIVER_BLOCKED: 'DRIVER_BLOCKED',
  VEHICLE_TYPE_MISMATCH: 'VEHICLE_TYPE_MISMATCH',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  WALLET_BALANCE_TOO_LOW: 'WALLET_BALANCE_TOO_LOW',
};

// True when the driver is a founder (tolerates both field names in the codebase).
function isFounderDriver(driver) {
  const d = driver || {};
  return d.isFounder === true || d.founderEligible === true;
}

// True when the driver is blocked/suspended (tolerates both signals).
function isBlockedDriver(driver) {
  const d = driver || {};
  return d.isBlocked === true || d.verificationStatus === 'suspended';
}

// Subscription / trial gate — the part of ride eligibility that does NOT depend
// on a specific ride (no vehicle-match, no per-ride wallet check). Shared by
// canDriverReceiveRide (per-ride) and the cockpit availability gate
// (deriveEligibility in utils/driverCockpit.js) so both agree on one rule.
//
// Business rule:
//   - Founder: covered during the free window; after it, needs an active sub.
//   - Non-founder: first NON_FOUNDER_FREE_RIDES completed rides are free; from
//     the next ride on, an active subscription is required.
export function passesSubscriptionOrTrial(driver, now = Date.now()) {
  const d = driver || {};
  const sub = getEffectiveSubscriptionStatus(d, now);
  const subscriptionCovered = sub.status === 'free' || sub.status === 'active';

  if (isFounderDriver(d)) {
    return subscriptionCovered;
  }
  const usedRides = Number(d.freeRideCountUsed) || 0;
  return subscriptionCovered || usedRides < NON_FOUNDER_FREE_RIDES;
}

// Decides whether a driver can receive a specific ride request.
//
// rideRequest carries at least { vehicleType, distanceKm }. Returns
// { eligible: boolean, reason: RIDE_ELIGIBILITY_REASON }.
//
// Order of checks (fail fast):
//   1. approved by admin
//   2. not blocked/suspended
//   3. vehicle type matches the request
//   4. subscription/trial rules satisfied
//   5. wallet sufficient IF commission may apply to this ride
export function canDriverReceiveRide(driver, rideRequest, now = Date.now()) {
  const d = driver || {};
  const req = rideRequest || {};

  // 1. Must be admin approved.
  if (d.verificationStatus !== 'approved') {
    return reject(RIDE_ELIGIBILITY_REASON.NOT_APPROVED);
  }

  // 2. Must not be blocked/suspended.
  if (isBlockedDriver(d)) {
    return reject(RIDE_ELIGIBILITY_REASON.DRIVER_BLOCKED);
  }

  // 3. Vehicle type must match the ride request.
  if (req.vehicleType && d.vehicleType && req.vehicleType !== d.vehicleType) {
    return reject(RIDE_ELIGIBILITY_REASON.VEHICLE_TYPE_MISMATCH);
  }

  // 4. Subscription / trial rules (founder free window, or non-founder first 5
  //    free rides, or an active/free subscription). Shared with the cockpit.
  if (!passesSubscriptionOrTrial(d, now)) {
    return reject(RIDE_ELIGIBILITY_REASON.SUBSCRIPTION_REQUIRED);
  }

  // 5. Wallet check ONLY when commission may apply to this ride. During the 0%
  //    commission window (founder or 60-day free window) the wallet is never a
  //    blocker. Otherwise the driver must keep at least the minimum balance.
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
  console.log('[DriverEligibility] rejected reason=', reason);
  return { eligible: false, reason };
}
