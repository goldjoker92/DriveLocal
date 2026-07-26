// @ts-check
// createDriverPixPayment — an authenticated driver requests a real Mercado Pago
// Pix charge for a subscription or a wallet top-up.
//
// Security invariants:
//   - the driver id ALWAYS comes from auth, never from the client payload;
//   - subscription price is derived server-side from vehicleType (never client);
//   - wallet amounts are limited to a server-approved pilot allowlist;
//   - launch grace blocks unnecessary subscription/wallet payments with stable,
//     traceable reason codes;
//   - creation is idempotent on the client idempotency key, and the SAME key is
//     forwarded to the provider on retry;
//   - only safe fields are returned; no provider payload or PII leaks.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateEnum,
  validateIdempotencyKey,
  validatePositiveCentavos,
} = require('../validation/validators');
const { logInfo, logError } = require('../logging/logger');
const {
  acquireOperation,
  completeOperation,
  recordFailure,
  fingerprintPayload,
  OPERATION_STATES,
} = require('../idempotency/idempotency');
const driverC = require('../drivers/constants');
const { resolveCommercialPolicy } = require('../drivers/commercialPolicy');
const { computeSubscriptionExtension } = require('../drivers/subscriptionDomain');
const C = require('./constants');

const OPERATION_TYPE = 'create_pix_payment';

// SHA-256 of the idempotency key for logs (never log the raw key material).
function keyHash(key) {
  return fingerprintPayload({ k: key });
}

// Kept as a compatibility export for existing tests/callers. A paid subscription
// alone does not block renewal; only the founder/free-ride launch grace does.
function subscriptionAlreadyCovered(driver, nowMs) {
  return resolveCommercialPolicy(driver, nowMs).subscriptionPaymentBlockedByGrace;
}

function accountDeletionPending(driver) {
  return ['requested', 'processing'].includes(driver?.accountDeletionStatus);
}

/**
 * @param {{db:object, request:object, context:object, clock:{now:()=>number}, adapter:object}} args
 */
async function createDriverPixPayment({ db, request, context, clock, adapter }) {
  const traceId = context && context.traceId;
  const driverId = request && request.auth && request.auth.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'payment creation attempted without authentication',
    });
  }

  const payload = assertShape(request && request.data, {
    required: ['purpose', 'idempotencyKey'],
    optional: ['amountCentavos'],
  });
  const purpose = validateEnum(payload.purpose, C.PURPOSES, 'purpose');
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey);
  const nowMs = clock.now();

  logInfo(context, 'payment.create.started', {
    operation: OPERATION_TYPE,
    purpose,
    idempotencyKeyHash: keyHash(idempotencyKey),
  });

  // Load the driver (server-authoritative source for vehicle type / commercial policy).
  const driverRef = db.collection(driverC.DRIVERS).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'authenticated driver profile not found',
      safeMetadata: { field: 'driverId' },
    });
  }
  const driver = driverSnap.data() || {};
  if (accountDeletionPending(driver)) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: 'authenticated driver requested account deletion',
      safeMetadata: { reason: 'ACCOUNT_DELETION_PENDING' },
    });
  }

  const commercial = resolveCommercialPolicy(driver, nowMs);
  logInfo(context, 'payment.create.commercial_policy_resolved', {
    operation: OPERATION_TYPE,
    purpose,
    policyVersion: commercial.policyVersion,
    founder: commercial.founder,
    freePeriodActive: commercial.freePeriodActive,
    commissionBps: commercial.commissionBps,
    subscriptionCoverageSource: commercial.subscriptionCoverageSource,
    freeRidesRemaining: commercial.freeRidesRemaining,
  });

  // Resolve the amount server-side per purpose (never trust a client amount for
  // subscription; restrict wallet to the pilot allowlist).
  let amountCentavos;
  if (purpose === 'driver_subscription') {
    if (commercial.subscriptionPaymentBlockedByGrace) {
      logInfo(context, 'payment.create.not_required', {
        operation: OPERATION_TYPE,
        purpose,
        policyVersion: commercial.policyVersion,
        reasonCode: commercial.subscriptionCoverageSource,
        freeRidesRemaining: commercial.freeRidesRemaining,
      });
      throw new AppError(ERROR_CODES.PAYMENT_NOT_REQUIRED, {
        internalMessage: `subscription payment blocked by ${commercial.subscriptionCoverageSource}`,
        safeMetadata: {
          purpose,
          reason: commercial.subscriptionCoverageSource,
          freeRidesRemaining: commercial.freeRidesRemaining,
        },
      });
    }
    const { priceCentavos } = computeSubscriptionExtension(driver, nowMs);
    amountCentavos = priceCentavos;
  } else {
    // Wallet top-ups are unnecessary for every driver while commission is 0%.
    if (commercial.freePeriodActive) {
      logInfo(context, 'payment.create.not_required', {
        operation: OPERATION_TYPE,
        purpose,
        policyVersion: commercial.policyVersion,
        reasonCode: 'COMMISSION_FREE_WINDOW_ACTIVE',
      });
      throw new AppError(ERROR_CODES.PAYMENT_NOT_REQUIRED, {
        internalMessage: 'wallet top-up not required during commission-free window',
        safeMetadata: { purpose, reason: 'COMMISSION_FREE_WINDOW_ACTIVE' },
      });
    }
    const requested = validatePositiveCentavos(payload.amountCentavos, 'amountCentavos');
    if (!C.ALLOWED_TOPUP_CENTAVOS.includes(requested)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `unsupported top-up amount: ${requested}`,
        safeMetadata: { field: 'amountCentavos' },
      });
    }
    amountCentavos = requested;
  }

  // Idempotency: same key + same logical request -> replay stored safe result.
  const acq = await acquireOperation(
    db,
    {
      idempotencyKey,
      operationType: OPERATION_TYPE,
      actorUid: driverId,
      traceId,
      payload: { driverId, purpose, amountCentavos },
    },
    clock
  );
  if (!acq.acquired) {
    if (acq.state === OPERATION_STATES.COMPLETED) {
      logInfo(context, 'payment.create.duplicate_ignored', {
        operation: OPERATION_TYPE,
        purpose,
        idempotencyKeyHash: keyHash(idempotencyKey),
        normalizedStatus: OPERATION_STATES.COMPLETED,
      });
      return acq.resultReference || null;
    }
    throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
      internalMessage: 'payment creation already in progress for this idempotency operation',
    });
  }

  // Immutable local id BEFORE calling the provider — used as external_reference.
  const paymentRef = db.collection(C.PAYMENT_REQUESTS).doc();
  const localPaymentId = paymentRef.id;

  let order;
  try {
    order = await adapter.createPixOrder({
      localPaymentId,
      amountCentavos,
      idempotencyKey, // same provider idempotency key on retry
      purpose,
      description: purpose === 'driver_subscription' ? 'DriveLocal assinatura' : 'DriveLocal saldo',
    });
  } catch (err) {
    const appErr = AppError.from(err);
    await recordFailure(db, idempotencyKey, { retryable: appErr.retryable }, clock);
    logError(context, 'payment.create.provider_failure', {
      operation: OPERATION_TYPE,
      localPaymentId,
      purpose,
      errorCode: appErr.code,
      idempotencyKeyHash: keyHash(idempotencyKey),
    });
    throw appErr;
  }

  const expiresAtMs = nowMs + C.ORDER_EXPIRATION_MS;
  await paymentRef.set({
    driverId,
    purpose,
    amountCentavos,
    currency: C.CURRENCY,
    provider: C.PROVIDER,
    providerOrderId: order.providerOrderId,
    externalReference: localPaymentId,
    status: C.STATUS.PENDING,
    qrCode: order.qrCode || null,
    qrCodeBase64: order.qrCodeBase64 || null,
    environment: context && context.environment ? context.environment : null,
    idempotencyKey,
    idempotencyFingerprint: fingerprintPayload({ driverId, purpose, amountCentavos }),
    commercialPolicyVersion: commercial.policyVersion,
    commercialPolicyReason: commercial.subscriptionCoverageSource,
    appliedAtMs: null,
    createdAtMs: nowMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAtMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logInfo(context, 'payment.create.provider_success', {
    operation: OPERATION_TYPE,
    localPaymentId,
    providerOrderId: order.providerOrderId,
    purpose,
    normalizedStatus: C.STATUS.PENDING,
    policyVersion: commercial.policyVersion,
    idempotencyKeyHash: keyHash(idempotencyKey),
  });

  // Only safe information is returned to the app.
  const safeResult = {
    localPaymentId,
    status: C.STATUS.PENDING,
    qrCode: order.qrCode || null,
    qrCodeBase64: order.qrCodeBase64 || null,
    expiration: expiresAtMs,
    amountCentavos,
  };
  await completeOperation(db, idempotencyKey, safeResult, clock);
  return safeResult;
}

module.exports = {
  createDriverPixPayment,
  subscriptionAlreadyCovered,
  accountDeletionPending,
};