// Driver wallet read service. The driver document provides live balances; raw
// ledger/payment collections remain server-only and are exposed through one safe
// callable projection.

import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export function listenToDriverWallet(driverId, onValue, onError) {
  if (!driverId) return () => undefined;

  return onSnapshot(
    doc(db, 'drivers', driverId),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.exists()) {
        onValue(null, { source: snapshot.metadata?.fromCache ? 'cache' : 'server' });
        return;
      }
      const data = snapshot.data() || {};
      const wallet = {
        walletBalanceCentavos: data.walletBalanceCentavos ?? null,
        walletAvailableCentavos: data.walletAvailableCentavos ?? null,
        walletHeldCentavos: data.walletHeldCentavos ?? null,
        walletLedgerVersion: data.walletLedgerVersion || null,
        commissionFreeUntil: data.commissionFreeUntil || null,
        approvedAtMs: data.approvedAtMs ?? null,
        approvedAt: data.approvedAt || null,
        founderExpiresAt: data.founderExpiresAt || null,
        founderEligible: data.founderEligible === true,
        founderNumber: data.founderNumber ?? null,
        approvalNumber: data.approvalNumber ?? null,
        vehicleType: data.vehicleType || null,
        serviceAreaId: data.serviceAreaId || null,
      };
      console.info('[DRIVER_WALLET] balance.snapshot', {
        scope: 'driver_wallet',
        event: 'balance.snapshot',
        driverId: shortId(driverId),
        source: snapshot.metadata?.fromCache ? 'cache' : 'server',
        hasAvailable: wallet.walletAvailableCentavos != null,
        hasHeld: wallet.walletHeldCentavos != null,
        hasBalance: wallet.walletBalanceCentavos != null,
        atMs: Date.now(),
      });
      onValue(wallet, { source: snapshot.metadata?.fromCache ? 'cache' : 'server' });
    },
    (error) => {
      console.warn('[DRIVER_WALLET] balance.listener_failed', {
        scope: 'driver_wallet',
        event: 'balance.listener_failed',
        driverId: shortId(driverId),
        reason: error?.code || error?.message || 'unknown',
        atMs: Date.now(),
      });
      if (onError) onError(error);
    }
  );
}

export async function loadDriverWalletSnapshot() {
  const startedAt = Date.now();
  const call = httpsCallable(functions, 'getDriverWalletSnapshot');
  try {
    const response = await call({});
    const snapshot = response.data || null;
    console.info('[DRIVER_WALLET] history.loaded', {
      scope: 'driver_wallet',
      event: 'history.loaded',
      version: snapshot?.version || null,
      transactionCount: Array.isArray(snapshot?.transactions) ? snapshot.transactions.length : 0,
      paymentCount: Array.isArray(snapshot?.payments) ? snapshot.payments.length : 0,
      durationMs: Date.now() - startedAt,
      atMs: Date.now(),
    });
    return snapshot;
  } catch (error) {
    console.warn('[DRIVER_WALLET] history.load_failed', {
      scope: 'driver_wallet',
      event: 'history.load_failed',
      reason: error?.code || error?.message || 'unknown',
      durationMs: Date.now() - startedAt,
      atMs: Date.now(),
    });
    throw error;
  }
}
