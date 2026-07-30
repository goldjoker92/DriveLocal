// @ts-check
// createDriverPixPayment — an authenticated driver requests a real Mercado Pago
// Pix charge for a subscription or a wallet top-up.
//
// Security invariants:
//   - driver identity and payer data come from Firebase Auth / the driver profile;
//   - passenger data never enters this payment flow;
//   - subscription price is derived server-side and wallet amounts are bounded;
//   - creation is idempotent locally and at Mercado Pago;
//   - CPF, email and device-session data are never logged or persisted here;
//   - only safe payment fields are returned to the mobile app.

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
const {
  STATEMENT_DESCRIPTOR,
  buildDriverPayer,
  buildOrderItem,
  buildAdditionalInfo,
  normalizeDeviceSessionId,
} = require('./orderQualityData');
const C = require('./constants');

const OPERATION_TYPE = 'create_pix_payment';

function keyHash(key) {
  return fingerprintPayload({ k: key });
}

function subscriptionAlreadyCovered(driver, nowMs) {
  return resolveCommercialPolicy(driver, nowMs).subscriptionPaymentBlockedByGrace;
}

function accountDeletionPending(driver) {
  return ['requested', 'processing'].includes(driver?.accountDeletionStatus);
}

function validateWalletTopupAmount(payload) {
  const requested = validatePositiveCentavos(payload.amountCentavos, 'amountCentavos');
  const customAmount = payload.customAmount === true;

  if (payload.customAmount != null && typeof payload.customAmount !== 'boolean') {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'customAmount must be boolean',
      safeMetadata: { field: 'customAmount' },
    });
  }

  if (customAmount) {
    if (
      requested < C.WALLET_TOPUP_MIN_CENTAVOS
      || requested > C.WALLET_TOPUP_MAX_CENTAVOS
    ) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `custom top-up outside range: ${requested}`,
        safeMetadata: {
          field: 'amountCentavos',
          minCentavos: C.WALLET_TOPUP_MIN_CENTAVOS,
          maxCentavos: C.WALLET_TOPUP_MAX_CENTAVOS,
        },
      });
    }
    return { amountCentavos: requested, customAmount: true };
  }

  if (!C.ALLOWED_TOPUP_CENTAVOS.includes(requested)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `unsupported preset top-up amount: ${requested}`,
      safeMetadata: { field: 'amountCentavos' },
    });
  }
  return { amountCentavos: requested, customAmount: false };
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
    optional: ['amountCentavos', 'customAmount', 'deviceSessionId'],
  });
  const purpose = validateEnum(payload.purpose, C.PURPOSES, 'purpose');
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey);
  const deviceSessionId = normalizeDeviceSessionId(payload.deviceSessionId);
  const nowMs = clock.now();

  logInfo(context, 'payment.create.started', {
    operation: OPERATION_TYPE,
    purpose,
    idempotencyKeyHash: keyHash(idempotencyKey),
    deviceSessionIdProvided: Boolean(deviceSessionId),
  });

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

  let amountCentavos;
  let customAmount = false;
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
    amountCentavos = computeSubscriptionExtension(driver, nowMs).priceCentavos;
  } else {
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
    const validatedTopup = validateWalletTopupAmount(payload);
    amountCentavos = validatedTopup.amountCentavos;
    customAmount = validatedTopup.customAmount;
  }

  const acq = await acquireOperation(
    db,
    {
      idempotencyKey,
      operationType: OPERATION_TYPE,
      actorUid: driverId,
      traceId,
      payload: { driverId, purpose, amountCentavos, customAmount },
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

  // Build provider enrichment only after local idempotency acquisition. Completed
  // replays therefore return the stored safe result without re-reading/sending PII.
  const payer = buildDriverPayer({
    driver,
    authToken: request && request.auth ? request.auth.token : null,
  });
  const item = buildOrderItem({
    purpose,
    vehicleType: driver.vehicleType,
    amountCentavos,
  });
  const additionalInfo = buildAdditionalInfo(driver);

  logInfo(context, 'payment.create.provider_payload_prepared', {
    operation: OPERATION_TYPE,
    purpose,
    payerEmailConfigured: Boolean(payer.email),
    payerFirstNameConfigured: Boolean(payer.first_name),
    payerLastNameConfigured: Boolean(payer.last_name),
    payerCpfConfigured: Boolean(payer.identification && payer.identification.number),
    deviceSessionIdProvided: Boolean(deviceSessionId),
    itemCategoryId: item.category_id,
  });

  const paymentRef = db.collection(C.PAYMENT_REQUESTS).doc();
  const localPaymentId = paymentRef.id;

  let order;
  try {
    order = await adapter.createPixOrder({
      localPaymentId,
      amountCentavos,
      idempotencyKey,
      purpose,
      description: purpose === 'driver_subscription' ? 'DriveLocal assinatura' : 'DriveLocal saldo',
      payer,
      items: [item],
      additionalInfo,
      statementDescriptor: STATEMENT_DESCRIPTOR,
      deviceSessionId,
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
    customAmount,
    currency: C.CURRENCY,
    provider: C.PROVIDER,
    providerOrderId: order.providerOrderId,
    externalReference: localPaymentId,
    status: C.STATUS.PENDING,
    qrCode: order.qrCode || null,
    qrCodeBase64: order.qrCodeBase64 || null,
    environment: context && context.environment ? context.environment : null,
    idempotencyKey,
    idempotencyFingerprint: fingerprintPayload({ driverId, purpose, amountCentavos, customAmount }),
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
    customAmount,
    normalizedStatus: C.STATUS.PENDING,
    policyVersion: commercial.policyVersion,
    idempotencyKeyHash: keyHash(idempotencyKey),
  });

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
  validateWalletTopupAmount,
};
