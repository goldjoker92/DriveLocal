// @ts-check
// Safe driver-owned wallet projection. Raw financial collections remain server-only:
// this handler returns only the balance, commercial lock state, ledger fields needed
// by the wallet UI, and normalized wallet-top-up payment statuses.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { logInfo } = require('../logging/logger');
const { resolveCommercialPolicy } = require('../drivers/commercialPolicy');
const driverC = require('../drivers/constants');
const paymentC = require('../payments/constants');

const SNAPSHOT_VERSION = 'driver-wallet-snapshot-v1';
const LEDGER_LIMIT = 100;
const PAYMENT_LIMIT = 50;

function optionalNonNegativeCentavos(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0
    ? number
    : null;
}

function optionalSignedCentavos(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) ? number : null;
}

function optionalTimestampMs(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0
    ? number
    : null;
}

function safeText(value, max = 60) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

function safeLedgerEntry(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    type: safeText(data.type),
    status: safeText(data.status),
    rideId: safeText(data.rideId, 128),
    paymentId: safeText(data.paymentId, 128),
    reasonCode: safeText(data.reasonCode, 40),
    amountCentavos: optionalNonNegativeCentavos(data.amountCentavos),
    availableDeltaCentavos: optionalSignedCentavos(data.availableDeltaCentavos),
    balanceDeltaCentavos: optionalSignedCentavos(data.balanceDeltaCentavos),
    availableAfterCentavos: optionalNonNegativeCentavos(data.availableAfterCentavos),
    balanceAfterCentavos: optionalNonNegativeCentavos(data.balanceAfterCentavos),
    capturedCentavos: optionalNonNegativeCentavos(data.capturedCentavos),
    releasedCentavos: optionalNonNegativeCentavos(data.releasedCentavos),
    createdAtMs: optionalTimestampMs(data.createdAtMs),
    settledAtMs: optionalTimestampMs(data.settledAtMs),
  };
}

function safePaymentEntry(snapshot) {
  const data = snapshot.data() || {};
  return {
    localPaymentId: snapshot.id,
    purpose: data.purpose === 'wallet_topup' ? 'wallet_topup' : null,
    status: safeText(data.status, 32),
    amountCentavos: optionalNonNegativeCentavos(data.amountCentavos),
    customAmount: data.customAmount === true,
    createdAtMs: optionalTimestampMs(data.createdAtMs),
    expiresAtMs: optionalTimestampMs(data.expiresAtMs),
    appliedAtMs: optionalTimestampMs(data.appliedAtMs),
  };
}

async function getDriverWalletSnapshot({ db, request, context, clock }) {
  const driverId = request?.auth?.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'wallet snapshot requested without authentication',
    });
  }

  const driverRef = db.collection(driverC.DRIVERS).doc(driverId);
  const [driverSnap, ledgerSnap, paymentSnap] = await Promise.all([
    driverRef.get(),
    db.collection(paymentC.WALLET_TRANSACTIONS)
      .where('driverId', '==', driverId)
      .orderBy('createdAtMs', 'desc')
      .limit(LEDGER_LIMIT)
      .get(),
    db.collection(paymentC.PAYMENT_REQUESTS)
      .where('driverId', '==', driverId)
      .where('purpose', '==', 'wallet_topup')
      .orderBy('createdAtMs', 'desc')
      .limit(PAYMENT_LIMIT)
      .get(),
  ]);

  if (!driverSnap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'authenticated driver profile not found for wallet snapshot',
      safeMetadata: { field: 'driverId' },
    });
  }

  const driver = driverSnap.data() || {};
  const nowMs = clock.now();
  const commercial = resolveCommercialPolicy(driver, nowMs);
  const transactions = ledgerSnap.docs.map(safeLedgerEntry);
  const payments = paymentSnap.docs.map(safePaymentEntry);

  logInfo(context, 'wallet.snapshot.loaded', {
    operation: 'get_driver_wallet_snapshot',
    snapshotVersion: SNAPSHOT_VERSION,
    transactionCount: transactions.length,
    paymentCount: payments.length,
    topupLocked: commercial.freePeriodActive,
  });

  return {
    version: SNAPSHOT_VERSION,
    generatedAtMs: nowMs,
    wallet: {
      balanceCentavos: optionalNonNegativeCentavos(driver.walletBalanceCentavos),
      availableCentavos: optionalNonNegativeCentavos(driver.walletAvailableCentavos),
      heldCentavos: optionalNonNegativeCentavos(driver.walletHeldCentavos),
      ledgerVersion: safeText(driver.walletLedgerVersion, 30),
    },
    topupPolicy: {
      locked: commercial.freePeriodActive,
      unlockAtMs: commercial.freePeriodUntilMs || null,
      minCentavos: paymentC.WALLET_TOPUP_MIN_CENTAVOS,
      maxCentavos: paymentC.WALLET_TOPUP_MAX_CENTAVOS,
      presetCentavos: [...paymentC.ALLOWED_TOPUP_CENTAVOS],
      policyVersion: commercial.policyVersion,
    },
    transactions,
    payments,
  };
}

module.exports = {
  getDriverWalletSnapshot,
  safeLedgerEntry,
  safePaymentEntry,
  optionalNonNegativeCentavos,
  optionalSignedCentavos,
  SNAPSHOT_VERSION,
};
