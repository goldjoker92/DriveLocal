// Driver subscription read service. Commercial state comes from drivers/{uid} in
// real time; the latest actionable Pix is restored through a safe authenticated
// callable because paymentRequests remains server-only.

import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

export function listenToDriverSubscription(driverId, onValue, onError) {
  if (!driverId) return () => undefined;

  return onSnapshot(
    doc(db, 'drivers', driverId),
    { includeMetadataChanges: true },
    (snapshot) => {
      const source = snapshot.metadata?.fromCache ? 'cache' : 'server';
      const confirmed = source === 'server' && snapshot.metadata?.hasPendingWrites !== true;
      if (!snapshot.exists()) {
        onValue(null, { source, confirmed });
        return;
      }

      const data = snapshot.data() || {};
      const subscription = {
        serviceAreaId: data.serviceAreaId || null,
        vehicleType: data.vehicleType || null,
        verificationStatus: data.verificationStatus || null,
        approvalNumber: data.approvalNumber ?? null,
        founderEligible: data.founderEligible === true,
        founderBadgeActive: data.founderBadgeActive === true,
        isFounder: data.isFounder === true,
        founderNumber: data.founderNumber ?? null,
        approvedAtMs: data.approvedAtMs ?? null,
        approvedAt: data.approvedAt || null,
        founderExpiresAt: data.founderExpiresAt || null,
        founderFreeUntil: data.founderFreeUntil || null,
        subscriptionFreeUntil: data.subscriptionFreeUntil || null,
        commissionFreeUntil: data.commissionFreeUntil || null,
        freeRideCountUsed: data.freeRideCountUsed ?? 0,
        subscriptionActive: data.subscriptionActive === true,
        subscriptionStatus: data.subscriptionStatus || null,
        subscriptionExpiresAt: data.subscriptionExpiresAt || null,
        subscriptionLastAmountCentavos: data.subscriptionLastAmountCentavos ?? null,
        subscriptionPaymentMode: data.subscriptionPaymentMode || null,
      };

      console.info('[DRIVER_SUBSCRIPTION] state.snapshot', {
        scope: 'driver_subscription',
        event: 'state.snapshot',
        driverId: shortId(driverId),
        source,
        confirmed,
        vehicleType: subscription.vehicleType,
        founder: subscription.founderEligible,
        freeRideCountUsed: Number(subscription.freeRideCountUsed || 0),
        subscriptionActive: subscription.subscriptionActive,
        hasExpiration: Boolean(subscription.subscriptionExpiresAt),
        atMs: Date.now(),
      });
      onValue(subscription, { source, confirmed });
    },
    (error) => {
      console.warn('[DRIVER_SUBSCRIPTION] state.listener_failed', {
        scope: 'driver_subscription',
        event: 'state.listener_failed',
        driverId: shortId(driverId),
        reason: error?.code || error?.message || 'unknown',
        atMs: Date.now(),
      });
      if (onError) onError(error);
    }
  );
}

export async function loadDriverSubscriptionSnapshot() {
  const startedAt = Date.now();
  const call = httpsCallable(functions, 'getDriverSubscriptionSnapshot');
  try {
    const response = await call({});
    const snapshot = response.data || null;
    console.info('[DRIVER_SUBSCRIPTION] payment_snapshot.loaded', {
      scope: 'driver_subscription',
      event: 'payment_snapshot.loaded',
      version: snapshot?.version || null,
      hasRestorablePayment: Boolean(snapshot?.payment?.localPaymentId),
      status: snapshot?.payment?.status || null,
      durationMs: Date.now() - startedAt,
      atMs: Date.now(),
    });
    return snapshot;
  } catch (error) {
    console.warn('[DRIVER_SUBSCRIPTION] payment_snapshot.failed', {
      scope: 'driver_subscription',
      event: 'payment_snapshot.failed',
      reason: error?.code || error?.message || 'unknown',
      durationMs: Date.now() - startedAt,
      atMs: Date.now(),
    });
    throw error;
  }
}
