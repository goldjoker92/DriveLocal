// Wallet commission service (DriveLocal V1).
//
// Handles ride-completion billing INSIDE a Firestore transaction so it is safe
// against retries and concurrent writes. Two things happen at completion:
//   1. the non-founder free-ride counter is incremented (once per ride);
//   2. the DriveLocal commission is debited from the driver prepaid wallet
//      (once per ride), but only when commission applies to that ride.
//
// Idempotency: a single flag on the ride document (commissionSettled) guards BOTH
// the counter increment and the wallet debit, so a retried completion can never
// double-increment or double-charge.
//
// Convention note: the codebase uses the Firebase Web SDK (firebase/firestore),
// so we accept driverId/rideId strings and build the doc refs here (rather than
// passing raw DocumentReferences). Follows the existing driverService style.

import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  calculateCommissionBps,
  calculatePlatformFeeCentavos,
} from '../utils/ridePricing';

// True when the driver holds founder status (tolerates both field names).
function isFounderDriver(driver) {
  const d = driver || {};
  return d.isFounder === true || d.founderEligible === true;
}

// Settles commission for a completed ride and increments the non-founder
// free-ride counter, atomically and idempotently.
//
// The ride document is expected to carry the pricing snapshot written by the
// ride-completion flow: ridePriceCentavos, vehicleType and distanceKm. Until the
// ride flow is wired to persist them, callers may pass them via `override`.
//
// TODO(ride-flow): when ride completion is implemented, write ridePriceCentavos,
// vehicleType and distanceKm onto the ride doc (from utils/ridePricing.js) and
// call this function once, at completion.
//
// Returns one of:
//   { skipped: 'already_settled' }
//   { skipped: 'missing_ride' | 'missing_price' }
//   { settled: true, commissionBps, platformFeeCentavos, walletBalanceCentavos }
export async function debitCommissionFromWallet(driverId, rideId, override = {}) {
  const rideCollection = override.rideCollection || 'rideRequests';
  const now = Date.now();

  return runTransaction(db, async (tx) => {
    const driverRef = doc(db, 'drivers', driverId);
    const rideRef = doc(db, rideCollection, rideId);

    // All reads must happen before any write in a Firestore transaction.
    const driverSnap = await tx.get(driverRef);
    const rideSnap = await tx.get(rideRef);

    if (!rideSnap.exists()) {
      console.log('[WalletCommission] missing ride rideId=', rideId);
      return { skipped: 'missing_ride' };
    }

    const ride = rideSnap.data() || {};
    const driver = driverSnap.exists() ? driverSnap.data() : {};

    // Idempotency guard: never settle the same ride twice.
    if (ride.commissionSettled === true) {
      console.log('[WalletCommission] already settled rideId=', rideId);
      return { skipped: 'already_settled' };
    }

    const vehicleType = override.vehicleType || ride.vehicleType || driver.vehicleType;
    const distanceKm = override.distanceKm != null ? override.distanceKm : ride.distanceKm;
    const ridePriceCentavos =
      override.ridePriceCentavos != null ? override.ridePriceCentavos : ride.ridePriceCentavos;

    if (ridePriceCentavos == null) {
      console.log('[WalletCommission] missing ridePriceCentavos rideId=', rideId);
      return { skipped: 'missing_price' };
    }

    // Commission for this ride (0 during the launch/founder free window).
    const commissionBps = calculateCommissionBps(vehicleType, distanceKm, driver, now);
    const platformFeeCentavos = calculatePlatformFeeCentavos(ridePriceCentavos, commissionBps);

    const currentBalance = Number(driver.walletBalanceCentavos) || 0;

    // Reject settlement when commission applies but the wallet cannot cover it.
    // The ride is NOT marked settled here, so it can be retried after a recharge
    // (no counter increment, no debit). Business rule: only commissionable rides
    // are ever blocked by the wallet — a 0% ride always settles.
    if (platformFeeCentavos > 0 && currentBalance < platformFeeCentavos) {
      console.log(
        '[WalletCommission] rejected WALLET_BALANCE_TOO_LOW rideId=', rideId,
        'need=', platformFeeCentavos, 'have=', currentBalance
      );
      return {
        rejected: true,
        reason: 'WALLET_BALANCE_TOO_LOW',
        platformFeeCentavos,
        walletBalanceCentavos: currentBalance,
      };
    }

    // Non-founder free-ride counter increments once per completed ride.
    const driverWrite = { updatedAt: serverTimestamp() };
    if (!isFounderDriver(driver)) {
      const used = Number(driver.freeRideCountUsed) || 0;
      driverWrite.freeRideCountUsed = used + 1;
    }

    // Debit the wallet only when commission actually applies.
    let newBalance = currentBalance;
    if (platformFeeCentavos > 0) {
      newBalance = currentBalance - platformFeeCentavos;
      driverWrite.walletBalanceCentavos = newBalance;
      console.log('[WalletCommission] debit success', platformFeeCentavos, 'centavos -> balance', newBalance);
    } else {
      console.log('[WalletCommission] skipped debit — 0% commission (free window or 0% tier) rideId=', rideId);
    }

    // Persist driver + ride idempotency fields in the same transaction.
    tx.update(driverRef, driverWrite);
    tx.update(rideRef, {
      commissionBps,
      platformFeeCentavos,
      commissionDebited: platformFeeCentavos > 0,
      commissionChargedAt: serverTimestamp(),
      commissionSettledAt: serverTimestamp(),
      commissionTransactionId: `commission_${rideId}`,
      commissionSettled: true, //  the idempotency guard
      updatedAt: serverTimestamp(),
    });

    return {
      settled: true,
      commissionBps,
      platformFeeCentavos,
      walletBalanceCentavos: newBalance,
    };
  });
}
