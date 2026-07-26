// @ts-check
// Minimal support workflow. The server derives identity, role, ride/payment context
// and stores codes only. No free-text field exists in the public contract.

const crypto = require('crypto');
const admin = require('firebase-admin');

const { AppError, ERROR_CODES } = require('../errors/appError');
const {
  assertShape,
  validateEnum,
  validateIdentifier,
  validateIdempotencyKey,
} = require('../validation/validators');
const { logInfo, logWarning, shortHash } = require('../logging/logger');
const { writeAuditLog } = require('../audit/auditLog');
const rideC = require('../rides/constants');
const paymentC = require('../payments/constants');
const {
  SUPPORT_TICKETS,
  MAX_USER_TICKETS,
  MAX_OPEN_TICKETS,
  DUPLICATE_WINDOW_MS,
  STATUS,
  ACTIVE_STATUSES,
  CATEGORIES,
  RESOLUTION_CODES,
  categoryDefinition,
  categoryAllowedForRole,
  statusTransitionAllowed,
  resolutionRequired,
} = require('./policy');

const SAFE_SOURCE_ROUTES = Object.freeze([
  'driver_home',
  'passenger_home',
  'active_ride',
  'driver_accepted',
  'pix_payment',
  'privacy_center',
  'unknown',
]);
const ADMIN_LIST_LIMIT = 100;

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function hash(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function requireAuthUid(request) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'support operation without authentication',
    });
  }
  return uid;
}

async function actorRole(db, uid) {
  const [driverSnap, passengerSnap] = await Promise.all([
    db.collection(rideC.DRIVERS).doc(uid).get(),
    db.collection(rideC.PASSENGERS).doc(uid).get(),
  ]);
  const driverExists = driverSnap.exists;
  const passengerExists = passengerSnap.exists;
  if (driverExists === passengerExists) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: driverExists
        ? 'support actor has conflicting roles'
        : 'support actor profile not found',
      safeMetadata: { reason: driverExists ? 'ROLE_CONFLICT' : 'PROFILE_NOT_FOUND' },
    });
  }
  const role = driverExists ? 'driver' : 'passenger';
  const profile = driverExists ? driverSnap.data() || {} : passengerSnap.data() || {};
  if (['requested', 'processing'].includes(profile.accountDeletionStatus)) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: 'support actor requested account deletion',
      safeMetadata: { reason: 'ACCOUNT_DELETION_PENDING' },
    });
  }
  return { role, profile };
}

async function requireAdmin(db, uid) {
  const snap = await db.collection('admins').doc(uid).get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.ADMIN_REQUIRED, {
      internalMessage: 'support admin operation without admin role',
    });
  }
}

function createArgs(request) {
  const payload = assertShape(request?.data, {
    required: ['categoryCode', 'idempotencyKey'],
    optional: ['rideId', 'sourceRoute'],
  });
  return {
    categoryCode: validateEnum(payload.categoryCode, Object.keys(CATEGORIES), 'categoryCode'),
    rideId: payload.rideId == null ? null : validateIdentifier(payload.rideId, 'rideId'),
    sourceRoute: payload.sourceRoute == null
      ? 'unknown'
      : validateEnum(payload.sourceRoute, SAFE_SOURCE_ROUTES, 'sourceRoute'),
    idempotencyKey: validateIdempotencyKey(payload.idempotencyKey),
  };
}

function safeRideSnapshot(ride) {
  return {
    status: String(ride?.status || 'unknown'),
    vehicleType: ride?.vehicleType || null,
    serviceAreaId: ride?.serviceAreaId || null,
    createdAtMs: Number(ride?.createdAtMs || 0) || null,
    acceptedAtMs: Number(ride?.acceptedAtMs || 0) || null,
    driverArrivedAtMs: Number(ride?.driverArrivedAtMs || 0) || null,
    completedAtMs: Number(ride?.completedAtMs || 0) || null,
    paymentAmountCentavos: Number(
      ride?.paymentAmountCentavos != null
        ? ride.paymentAmountCentavos
        : ride?.finalFareCentavos || 0
    ) || null,
    passengerMarkedPaid: Number(ride?.passengerMarkedPaidAtMs || 0) > 0,
    commissionSettlementStatus: ride?.commissionSettlementStatus || null,
    cancelReasonCode: ride?.cancelReasonCode || null,
    cancellationStage: ride?.cancellationStage || null,
    disputeReasonCode: ride?.disputeReasonCode || ride?.paymentIssueReasonCode || null,
  };
}

async function loadRideContext(db, uid, role, rideId) {
  if (!rideId) return null;
  const snap = await db.collection(rideC.RIDE_REQUESTS).doc(rideId).get();
  if (!snap.exists) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'support ride not found',
      safeMetadata: { field: 'rideId' },
    });
  }
  const ride = snap.data() || {};
  const ownsRide = role === 'driver'
    ? ride.acceptedDriverId === uid
    : ride.passengerId === uid;
  if (!ownsRide) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      internalMessage: 'support actor is not a ride party',
    });
  }
  return safeRideSnapshot(ride);
}

async function latestDriverPayment(db, uid, purpose) {
  if (!purpose) return null;
  const snap = await db.collection(paymentC.PAYMENT_REQUESTS)
    .where('driverId', '==', uid)
    .where('purpose', '==', purpose)
    .orderBy('createdAtMs', 'desc')
    .limit(1)
    .get();
  const paymentDoc = snap.docs[0];
  if (!paymentDoc) return null;
  const payment = { paymentRequestId: paymentDoc.id, ...paymentDoc.data() };
  return {
    paymentRequestId: payment.paymentRequestId,
    purpose: payment.purpose,
    status: payment.status || 'unknown',
    amountCentavos: Number(payment.amountCentavos || 0) || null,
    provider: payment.provider || null,
    providerOrderId: payment.providerOrderId || null,
    createdAtMs: Number(payment.createdAtMs || 0) || null,
    expiresAtMs: Number(payment.expiresAtMs || 0) || null,
  };
}

function issueFingerprint({ uid, categoryCode, rideId, paymentRequestId }) {
  return hash(`${uid}:${categoryCode}:${rideId || ''}:${paymentRequestId || ''}`, 32);
}

function ticketDocumentId(uid, idempotencyKey) {
  return `st_${hash(`${uid}:${idempotencyKey}`, 28)}`;
}

async function activeActorTickets(db, uid) {
  const snap = await db.collection(SUPPORT_TICKETS)
    .where('actorUid', '==', uid)
    .where('status', 'in', ACTIVE_STATUSES)
    .limit(MAX_OPEN_TICKETS + 1)
    .get();
  return snap.docs.map((docSnap) => ({ ticketId: docSnap.id, ...docSnap.data() }));
}

async function recentActorTickets(db, uid) {
  const snap = await db.collection(SUPPORT_TICKETS)
    .where('actorUid', '==', uid)
    .orderBy('createdAtMs', 'desc')
    .limit(MAX_USER_TICKETS)
    .get();
  return snap.docs.map((docSnap) => ({ ticketId: docSnap.id, ...docSnap.data() }));
}

function myTicketProjection(ticket) {
  return {
    ticketId: ticket.ticketId,
    actorRole: ticket.actorRole,
    categoryCode: ticket.categoryCode,
    status: ticket.status,
    rideId: ticket.rideId || null,
    paymentRequestId: ticket.paymentRequestId || null,
    resolutionCode: ticket.resolutionCode || null,
    createdAtMs: Number(ticket.createdAtMs || 0) || null,
    updatedAtMs: Number(ticket.updatedAtMs || 0) || null,
  };
}

function adminTicketProjection(ticket) {
  return {
    ...myTicketProjection(ticket),
    actorHash: ticket.actorHash || null,
    sourceRoute: ticket.sourceRoute || 'unknown',
    contextSnapshot: ticket.contextSnapshot || null,
    providerOrderId: ticket.providerOrderId || null,
    adminUpdatedAtMs: Number(ticket.adminUpdatedAtMs || 0) || null,
  };
}

async function createSupportTicket({ db, request, context, clock }) {
  const uid = requireAuthUid(request);
  const args = createArgs(request);
  const { role } = await actorRole(db, uid);
  const definition = categoryDefinition(args.categoryCode);
  if (!definition || !categoryAllowedForRole(args.categoryCode, role)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      internalMessage: 'support category not allowed for actor role',
      safeMetadata: { reason: 'CATEGORY_NOT_ALLOWED', actorRole: role },
    });
  }
  if (definition.requiresRide && !args.rideId) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'support category requires ride context',
      safeMetadata: { field: 'rideId' },
    });
  }

  const [rideSnapshot, paymentSnapshot, actorTickets] = await Promise.all([
    loadRideContext(db, uid, role, args.rideId),
    role === 'driver' ? latestDriverPayment(db, uid, definition.paymentPurpose) : null,
    activeActorTickets(db, uid),
  ]);
  const nowMs = Number(clock.now());
  const paymentRequestId = paymentSnapshot?.paymentRequestId || null;
  const fingerprint = issueFingerprint({
    uid,
    categoryCode: args.categoryCode,
    rideId: args.rideId,
    paymentRequestId,
  });
  const duplicate = actorTickets.find((ticket) => (
    ticket.issueFingerprint === fingerprint
    && nowMs - Number(ticket.createdAtMs || 0) <= DUPLICATE_WINDOW_MS
  ));
  if (duplicate) {
    logInfo(context, 'support.ticket_duplicate_reused', {
      operation: 'create_support_ticket',
      ticketId: duplicate.ticketId,
      categoryCode: args.categoryCode,
      actorRole: role,
      hasRideContext: Boolean(args.rideId),
      hasPaymentContext: Boolean(paymentRequestId),
    });
    return { ...myTicketProjection(duplicate), replay: true, duplicate: true };
  }
  if (actorTickets.length >= MAX_OPEN_TICKETS) {
    throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
      internalMessage: 'support actor open-ticket limit reached',
      safeMetadata: { reason: 'OPEN_TICKET_LIMIT', maxOpenTickets: MAX_OPEN_TICKETS },
    });
  }

  const ticketId = ticketDocumentId(uid, args.idempotencyKey);
  const ticketRef = db.collection(SUPPORT_TICKETS).doc(ticketId);
  const created = await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(ticketRef);
    if (existingSnap.exists) {
      const existing = { ticketId, ...existingSnap.data() };
      if (
        existing.actorUid !== uid
        || existing.categoryCode !== args.categoryCode
        || (existing.rideId || null) !== args.rideId
      ) {
        throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          internalMessage: 'support idempotency key reused for another request',
        });
      }
      return { ticket: existing, replay: true };
    }

    const record = {
      ticketId,
      actorUid: uid,
      actorHash: shortHash(uid),
      actorRole: role,
      categoryCode: args.categoryCode,
      status: STATUS.OPEN,
      resolutionCode: null,
      sourceRoute: args.sourceRoute,
      rideId: args.rideId,
      paymentRequestId,
      providerOrderId: paymentSnapshot?.providerOrderId || null,
      issueFingerprint: fingerprint,
      contextSnapshot: {
        ride: rideSnapshot,
        payment: paymentSnapshot ? {
          purpose: paymentSnapshot.purpose,
          status: paymentSnapshot.status,
          amountCentavos: paymentSnapshot.amountCentavos,
          provider: paymentSnapshot.provider,
          createdAtMs: paymentSnapshot.createdAtMs,
          expiresAtMs: paymentSnapshot.expiresAtMs,
        } : null,
      },
      createdAtMs: nowMs,
      createdAt: ts(),
      updatedAtMs: nowMs,
      updatedAt: ts(),
    };
    tx.create(ticketRef, record);
    return { ticket: record, replay: false };
  });

  logInfo(context, created.replay ? 'support.ticket_replayed' : 'support.ticket_created', {
    operation: 'create_support_ticket',
    ticketId,
    categoryCode: args.categoryCode,
    actorRole: role,
    hasRideContext: Boolean(args.rideId),
    hasPaymentContext: Boolean(paymentRequestId),
  });
  return { ...myTicketProjection({ ticketId, ...created.ticket }), replay: created.replay };
}

async function listMySupportTickets({ db, request }) {
  const uid = requireAuthUid(request);
  const { role } = await actorRole(db, uid);
  const tickets = await recentActorTickets(db, uid);
  return {
    actorRole: role,
    tickets: tickets.map(myTicketProjection),
  };
}

function adminListArgs(request) {
  const payload = assertShape(request?.data || {}, {
    required: [],
    optional: ['status', 'limit'],
  });
  const status = payload.status == null
    ? STATUS.OPEN
    : validateEnum(payload.status, ['all', ...Object.values(STATUS)], 'status');
  const requestedLimit = Number(payload.limit == null ? 50 : payload.limit);
  return {
    status,
    limit: Number.isSafeInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), ADMIN_LIST_LIMIT)
      : 50,
  };
}

async function listAdminSupportTickets({ db, request }) {
  const uid = requireAuthUid(request);
  await requireAdmin(db, uid);
  const args = adminListArgs(request);
  let query = db.collection(SUPPORT_TICKETS);
  if (args.status !== 'all') query = query.where('status', '==', args.status);
  const snap = await query.orderBy('createdAtMs', 'desc').limit(args.limit).get();
  return {
    status: args.status,
    tickets: snap.docs.map((docSnap) =>
      adminTicketProjection({ ticketId: docSnap.id, ...docSnap.data() })
    ),
  };
}

function adminUpdateArgs(request) {
  const payload = assertShape(request?.data, {
    required: ['ticketId', 'status', 'idempotencyKey'],
    optional: ['resolutionCode'],
  });
  const status = validateEnum(payload.status, Object.values(STATUS), 'status');
  const resolutionCode = payload.resolutionCode == null
    ? null
    : validateEnum(payload.resolutionCode, RESOLUTION_CODES, 'resolutionCode');
  if (resolutionRequired(status) && !resolutionCode) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'resolved support status requires resolution code',
      safeMetadata: { field: 'resolutionCode' },
    });
  }
  if (!resolutionRequired(status) && resolutionCode) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'active support status cannot carry resolution code',
      safeMetadata: { field: 'resolutionCode' },
    });
  }
  return {
    ticketId: validateIdentifier(payload.ticketId, 'ticketId'),
    status,
    resolutionCode,
    idempotencyKey: validateIdempotencyKey(payload.idempotencyKey),
  };
}

async function updateAdminSupportTicket({ db, request, context, clock }) {
  const adminUid = requireAuthUid(request);
  await requireAdmin(db, adminUid);
  const args = adminUpdateArgs(request);
  const operationHash = hash(`${adminUid}:${args.idempotencyKey}`, 24);
  const ticketRef = db.collection(SUPPORT_TICKETS).doc(args.ticketId);
  const nowMs = Number(clock.now());

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ticketRef);
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: 'support ticket not found for admin update',
      });
    }
    const before = snap.data() || {};
    if (before.lastAdminOperationHash === operationHash) {
      if (before.status !== args.status || (before.resolutionCode || null) !== args.resolutionCode) {
        throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          internalMessage: 'support admin key reused for another status change',
        });
      }
      return { replay: true, before, after: before };
    }
    if (before.status === args.status && (before.resolutionCode || null) === args.resolutionCode) {
      return { replay: true, before, after: before };
    }
    if (!statusTransitionAllowed(before.status, args.status)) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: 'unsupported support ticket status transition',
        safeMetadata: { fromStatus: before.status, toStatus: args.status },
      });
    }
    const update = {
      status: args.status,
      resolutionCode: args.resolutionCode,
      lastAdminOperationHash: operationHash,
      adminUpdatedAtMs: nowMs,
      adminUpdatedAt: ts(),
      updatedAtMs: nowMs,
      updatedAt: ts(),
    };
    tx.set(ticketRef, update, { merge: true });
    return { replay: false, before, after: { ...before, ...update } };
  });

  if (!out.replay) {
    try {
      await writeAuditLog(db, {
        actorUid: adminUid,
        actorType: 'admin',
        action: 'support_ticket_status_changed',
        targetType: 'support_ticket',
        targetId: args.ticketId,
        traceId: context?.traceId,
        beforeSummary: {
          status: out.before.status,
          resolutionCode: out.before.resolutionCode || null,
        },
        afterSummary: {
          status: args.status,
          resolutionCode: args.resolutionCode,
          categoryCode: out.before.categoryCode,
        },
      }, clock);
    } catch (auditError) {
      logWarning(context, 'support.ticket_audit_failed', {
        operation: 'update_support_ticket',
        ticketId: args.ticketId,
        errorCode: auditError?.code || auditError?.name || 'AUDIT_WRITE_FAILED',
      });
    }
  }

  logInfo(context, out.replay ? 'support.ticket_status_replayed' : 'support.ticket_status_changed', {
    operation: 'update_support_ticket',
    ticketId: args.ticketId,
    fromStatus: out.before.status,
    toStatus: args.status,
    resolutionCode: args.resolutionCode,
  });
  return {
    ticketId: args.ticketId,
    status: args.status,
    resolutionCode: args.resolutionCode,
    replay: out.replay,
  };
}

module.exports = {
  SAFE_SOURCE_ROUTES,
  createSupportTicket,
  listMySupportTickets,
  listAdminSupportTickets,
  updateAdminSupportTicket,
  safeRideSnapshot,
  latestDriverPayment,
  issueFingerprint,
  ticketDocumentId,
  myTicketProjection,
  adminTicketProjection,
  activeActorTickets,
  recentActorTickets,
};