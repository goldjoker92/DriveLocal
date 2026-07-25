// @ts-check
// Hourly financial integrity reconciliation. It never changes a ride or wallet
// balance automatically: anomalies create traceable admin alerts instead. This
// protects commissions without silently charging or releasing money.

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const rideC = require('../rides/constants');
const riskC = require('./constants');
const { stableId } = require('./riskEngine');

const REGION = 'southamerica-east1';
const TIME_ZONE = 'America/Fortaleza';
const STALE_HOLD_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
const LIMITS = Object.freeze({ rides: 3000, drivers: 1500, holds: 1000 });

function num(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function financialAlert({ reasonCode, severity, sourceType, sourceId, amountAtRiskCentavos = 0, metadata = {} }) {
  return { reasonCode, severity, sourceType, sourceId, amountAtRiskCentavos, metadata };
}

function analyzeRideFinancialState(ride, nowMs) {
  const alerts = [];
  const status = String(ride?.status || 'unknown');
  const sourceId = String(ride?.rideId || ride?.id || 'unknown');
  const hold = num(ride?.commissionHoldCentavos);
  const expected = num(ride?.finalCommissionCentavos ?? ride?.estimatedCommissionCentavos);
  const captured = num(ride?.commissionCapturedCentavos);
  const released = num(ride?.holdReleasedCentavos);
  const freeAtAcceptance = ride?.commissionPolicySnapshot?.commissionFreeAtAcceptance === true;

  if (captured > hold && hold >= 0) {
    alerts.push(financialAlert({
      reasonCode: riskC.REASON.COMMISSION_CAPTURE_EXCEEDS_HOLD,
      severity: riskC.SEVERITY.CRITICAL,
      sourceType: 'ride',
      sourceId,
      amountAtRiskCentavos: captured - hold,
      metadata: { rideStatus: status, holdCentavos: hold, capturedCentavos: captured },
    }));
  }

  if (status === rideC.RIDE_STATUS.COMPLETED) {
    const hasCaptureField = ride?.commissionCapturedCentavos != null;
    if (!hasCaptureField) {
      alerts.push(financialAlert({
        reasonCode: riskC.REASON.COMMISSION_NOT_SETTLED,
        severity: riskC.SEVERITY.CRITICAL,
        sourceType: 'ride',
        sourceId,
        amountAtRiskCentavos: Math.min(expected, hold),
        metadata: { rideStatus: status, holdCentavos: hold, amountCentavos: expected },
      }));
    } else if (!freeAtAcceptance && hold > 0 && expected > 0 && captured === 0) {
      alerts.push(financialAlert({
        reasonCode: riskC.REASON.COMMISSION_ZERO_WITHOUT_VALID_FREE_POLICY,
        severity: riskC.SEVERITY.CRITICAL,
        sourceType: 'ride',
        sourceId,
        amountAtRiskCentavos: Math.min(expected, hold),
        metadata: { rideStatus: status, holdCentavos: hold, capturedCentavos: captured, policyVersion: ride?.commissionPolicySnapshot?.policyVersion },
      }));
    }

    if (captured + released !== hold) {
      alerts.push(financialAlert({
        reasonCode: riskC.REASON.COMMISSION_NOT_SETTLED,
        severity: riskC.SEVERITY.HIGH,
        sourceType: 'ride',
        sourceId,
        amountAtRiskCentavos: Math.abs(hold - captured - released),
        metadata: { rideStatus: status, holdCentavos: hold, capturedCentavos: captured, releasedCentavos: released },
      }));
    }
  }

  const paymentPending = [
    rideC.RIDE_STATUS.AWAITING_PAYMENT,
    rideC.RIDE_STATUS.PAYMENT_MARKED_SENT,
    rideC.RIDE_STATUS.DISPUTED,
  ].includes(status);
  const pendingSince = num(ride?.disputedAtMs || ride?.passengerMarkedPaidAtMs || ride?.awaitingPaymentAtMs);
  if (paymentPending && hold > 0 && pendingSince > 0 && nowMs - pendingSince > STALE_HOLD_MS) {
    alerts.push(financialAlert({
      reasonCode: riskC.REASON.COMMISSION_HOLD_STALE,
      severity: status === rideC.RIDE_STATUS.DISPUTED ? riskC.SEVERITY.HIGH : riskC.SEVERITY.CRITICAL,
      sourceType: 'ride',
      sourceId,
      amountAtRiskCentavos: hold,
      metadata: { rideStatus: status, holdCentavos: hold, ageMs: nowMs - pendingSince },
    }));
  }

  if (status === rideC.RIDE_STATUS.CANCELLED && hold > 0) {
    alerts.push(financialAlert({
      reasonCode: riskC.REASON.COMMISSION_NOT_SETTLED,
      severity: riskC.SEVERITY.CRITICAL,
      sourceType: 'ride',
      sourceId,
      amountAtRiskCentavos: hold,
      metadata: { rideStatus: status, holdCentavos: hold },
    }));
  }

  return alerts;
}

function analyzeDriverWallet(driver) {
  const alerts = [];
  const sourceId = String(driver?.driverId || driver?.id || 'unknown');
  const balance = num(driver?.walletBalanceCentavos);
  const available = num(driver?.walletAvailableCentavos);
  const held = num(driver?.walletHeldCentavos);

  if (balance < 0 || available < 0 || held < 0) {
    alerts.push(financialAlert({
      reasonCode: riskC.REASON.WALLET_NEGATIVE,
      severity: riskC.SEVERITY.CRITICAL,
      sourceType: 'driver_wallet',
      sourceId,
      amountAtRiskCentavos: Math.abs(Math.min(balance, available, held)),
      metadata: { amountCentavos: balance, holdCentavos: held },
    }));
  }

  if (balance !== available + held) {
    alerts.push(financialAlert({
      reasonCode: riskC.REASON.WALLET_LEDGER_MISMATCH,
      severity: riskC.SEVERITY.CRITICAL,
      sourceType: 'driver_wallet',
      sourceId,
      amountAtRiskCentavos: Math.abs(balance - available - held),
      metadata: { amountCentavos: balance, holdCentavos: held },
    }));
  }
  return alerts;
}

async function upsertFinancialAlert(db, alert, nowMs) {
  const alertId = `fin_${stableId([alert.reasonCode, alert.sourceType, alert.sourceId])}`;
  const ref = db.collection(riskC.COLLECTIONS.FINANCIAL_ALERTS).doc(alertId);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const before = snapshot.exists ? snapshot.data() || {} : {};
    const resolved = before.status === 'resolved';
    tx.set(ref, {
      alertId,
      reasonCode: alert.reasonCode,
      severity: alert.severity,
      sourceType: alert.sourceType,
      sourceId: alert.sourceId,
      amountAtRiskCentavos: Math.max(0, num(alert.amountAtRiskCentavos)),
      metadata: alert.metadata || {},
      status: resolved ? 'reopened' : (before.status || 'open'),
      occurrenceCount: admin.firestore.FieldValue.increment(1),
      reopenedCount: resolved ? admin.firestore.FieldValue.increment(1) : num(before.reopenedCount),
      firstDetectedAtMs: before.firstDetectedAtMs || nowMs,
      lastDetectedAtMs: nowMs,
      ruleVersion: riskC.RULE_VERSION,
      createdAtMs: before.createdAtMs || nowMs,
      createdAt: before.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return alertId;
}

async function runFinancialReconciliation({ db, clock, context }) {
  const nowMs = Number(clock?.now?.() || Date.now());
  const startMs = nowMs - LOOKBACK_MS;
  const staleCutoffMs = nowMs - STALE_HOLD_MS;
  const [ridesSnap, driversSnap, staleHoldsSnap] = await Promise.all([
    db.collection(rideC.RIDE_REQUESTS).where('createdAtMs', '>=', startMs).limit(LIMITS.rides).get(),
    db.collection(rideC.DRIVERS).limit(LIMITS.drivers).get(),
    db.collection(rideC.WALLET_TRANSACTIONS).where('status', '==', 'held').where('createdAtMs', '<=', staleCutoffMs).limit(LIMITS.holds).get(),
  ]);

  const alerts = [];
  ridesSnap.forEach((document) => alerts.push(...analyzeRideFinancialState({ id: document.id, ...document.data() }, nowMs)));
  driversSnap.forEach((document) => alerts.push(...analyzeDriverWallet({ id: document.id, ...document.data() })));
  staleHoldsSnap.forEach((document) => {
    const hold = document.data() || {};
    alerts.push(financialAlert({
      reasonCode: riskC.REASON.COMMISSION_HOLD_STALE,
      severity: riskC.SEVERITY.CRITICAL,
      sourceType: 'wallet_transaction',
      sourceId: document.id,
      amountAtRiskCentavos: num(hold.amountCentavos),
      metadata: { holdCentavos: num(hold.amountCentavos), ageMs: nowMs - num(hold.createdAtMs) },
    }));
  });

  const unique = new Map();
  alerts.forEach((alert) => unique.set(`${alert.reasonCode}|${alert.sourceType}|${alert.sourceId}`, alert));
  await Promise.all([...unique.values()].map((alert) => upsertFinancialAlert(db, alert, nowMs)));

  const amountAtRiskCentavos = [...unique.values()].reduce((sum, alert) => sum + num(alert.amountAtRiskCentavos), 0);
  await db.collection(riskC.COLLECTIONS.SYSTEM_HEALTH).doc('financialIntegrity').set({
    status: unique.size === 0 ? 'ok' : [...unique.values()].some((alert) => alert.severity === riskC.SEVERITY.CRITICAL) ? 'critical' : 'attention',
    openDetectedCount: unique.size,
    amountAtRiskCentavos,
    scanned: { rides: ridesSnap.size, drivers: driversSnap.size, staleHolds: staleHoldsSnap.size },
    truncated: {
      rides: ridesSnap.size >= LIMITS.rides,
      drivers: driversSnap.size >= LIMITS.drivers,
      staleHolds: staleHoldsSnap.size >= LIMITS.holds,
    },
    lastCheckedAtMs: nowMs,
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  logInfo(context, 'finance.reconciliation.completed', {
    operation: 'financial_reconciliation',
    result: unique.size === 0 ? 'ok' : 'anomalies_detected',
    count: unique.size,
    amountCentavos: amountAtRiskCentavos,
  });
  return { alertCount: unique.size, amountAtRiskCentavos };
}

const financialReconciliationTask = onSchedule(
  { region: REGION, schedule: 'every 60 minutes', timeZone: TIME_ZONE, retryCount: 1 },
  async () => {
    const context = createLoggerContext({ functionName: 'financialReconciliationTask', actorType: 'system' });
    try {
      return await runFinancialReconciliation({
        db: admin.firestore(),
        clock: { now: () => Date.now() },
        context,
      });
    } catch (error) {
      logWarning(context, 'finance.reconciliation.failed', {
        operation: 'financial_reconciliation',
        internalMessage: error?.message,
      });
      throw error;
    }
  }
);

module.exports = {
  STALE_HOLD_MS,
  analyzeRideFinancialState,
  analyzeDriverWallet,
  upsertFinancialAlert,
  runFinancialReconciliation,
  financialReconciliationTask,
};
