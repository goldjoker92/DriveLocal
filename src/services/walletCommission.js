// Legacy client-side wallet settlement helper.
//
// The secure production flow freezes the commercial policy and commission hold
// in Cloud Functions at offer acceptance. This helper remains for older screens,
// but must never recompute a lower fee or turn a standard ride into free work.
// It therefore prefers the acceptance snapshot and falls back to the same shared
// V1.2 minimum-commission calculator only for legacy ride documents.

import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { getVehiclePricing } from '../constants/pricingConfig';
import {
  calculateCommissionBps,
  calculateConfiguredCommissionCentavos,
} from '../utils/ridePricing';

function isFounderDriver(driver) {
  const profile = driver || {};
  return profile.isFounder === true || profile.founderEligible === true;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function frozenCommissionForRide(ride) {
  const snapshotAmount = finiteNonNegative(
    ride?.commissionPolicySnapshot?.holdAmountCentavos
  );
  if (snapshotAmount != null) return snapshotAmount;

  const rideHold = finiteNonNegative(ride?.commissionHoldCentavos);
  if (rideHold != null) return rideHold;
  return null;
}

export async function debitCommissionFromWallet(driverId, rideId, override = {}) {
  const rideCollection = override.rideCollection || 'rideRequests';
  const now = Date.now();

  return runTransaction(db, async (tx) => {
    const driverRef = doc(db, 'drivers', driverId);
    const rideRef = doc(db, rideCollection, rideId);

    const driverSnap = await tx.get(driverRef);
    const rideSnap = await tx.get(rideRef);

    if (!rideSnap.exists()) {
      console.log('[WalletCommission] missing ride rideId=', rideId);
      return { skipped: 'missing_ride' };
    }

    const ride = rideSnap.data() || {};
    const driver = driverSnap.exists() ? driverSnap.data() : {};

    if (ride.commissionSettled === true) {
      console.log('[WalletCommission] already settled rideId=', rideId);
      return { skipped: 'already_settled' };
    }

    const vehicleType = override.vehicleType || ride.vehicleType || driver.vehicleType;
    const distanceKm = override.distanceKm != null ? override.distanceKm : ride.distanceKm;
    const ridePriceCentavos = override.ridePriceCentavos != null
      ? override.ridePriceCentavos
      : (ride.ridePriceCentavos ?? ride.estimatedFareCentavos);

    if (ridePriceCentavos == null) {
      console.log('[WalletCommission] missing ride price rideId=', rideId);
      return { skipped: 'missing_price' };
    }

    // Freeze semantics at acceptance. A driver who accepted during the 60-day
    // benefit remains at R$0 for this ride even if completion happens later.
    const frozenBps = finiteNonNegative(
      ride?.commercialPolicySnapshot?.commissionBpsAtAcceptance
    );
    const commissionBps = frozenBps != null
      ? frozenBps
      : calculateCommissionBps(vehicleType, distanceKm, driver, now);

    let platformFeeCentavos = frozenCommissionForRide(ride);
    if (platformFeeCentavos == null) {
      const vehiclePricing = getVehiclePricing(
        ride.serviceAreaId,
        vehicleType
      );
      const configured = calculateConfiguredCommissionCentavos({
        passengerFareCentavos: ridePriceCentavos,
        commissionBaseCentavos: ridePriceCentavos,
        commissionBps,
        vehiclePricing,
      });
      if (!configured.ok) {
        const error = new Error('INVALID_COMMISSION_CONFIGURATION');
        error.code = 'INVALID_COMMISSION_CONFIGURATION';
        throw error;
      }
      platformFeeCentavos = configured.commissionCentavos;
    }

    const currentBalance = Number(driver.walletBalanceCentavos) || 0;
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

    const driverWrite = { updatedAt: serverTimestamp() };
    if (!isFounderDriver(driver)) {
      const used = Number(driver.freeRideCountUsed) || 0;
      driverWrite.freeRideCountUsed = used + 1;
    }

    let newBalance = currentBalance;
    if (platformFeeCentavos > 0) {
      newBalance = currentBalance - platformFeeCentavos;
      driverWrite.walletBalanceCentavos = newBalance;
      console.log('[WalletCommission] debit success', platformFeeCentavos, 'centavos -> balance', newBalance);
    } else {
      console.log('[WalletCommission] skipped debit — 60-day commission benefit rideId=', rideId);
    }

    tx.update(driverRef, driverWrite);
    tx.update(rideRef, {
      commissionBps,
      platformFeeCentavos,
      commissionDebited: platformFeeCentavos > 0,
      commissionChargedAt: serverTimestamp(),
      commissionSettledAt: serverTimestamp(),
      commissionTransactionId: `commission_${rideId}`,
      commissionSettled: true,
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