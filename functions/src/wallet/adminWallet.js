// @ts-check
// Secure admin wallet adjustment (BLOCK 11+12). ONE callable, four operations:
// credit, debit, correction, reversal. All money is integer centavos.
//
// Immutability: the ledger is APPEND-ONLY. A correction or reversal NEVER edits
// or deletes the original entry — it writes a NEW compensating entry that
// references the original. Every adjustment records its net effect
// (availableDeltaCentavos / balanceDeltaCentavos) so a reversal can negate it
// deterministically.
//
// Invariants: amount > 0; walletHeldCentavos is NEVER touched here (active-ride
// holds move only via ride lifecycle / dispute resolution); available and balance
// never go negative (a debit with insufficient funds is rejected, never clamped);
// each adjustment is idempotent via a deterministic ledger id, and a reversal of
// a given entry can happen at most once.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier, validateEnum, validatePositiveCentavos, validateNonEmptyString, validateIdempotencyKey } = require('../validation/validators');
const { writeAuditLog } = require('../audit/auditLog');
const { requireAdmin } = require('../auth/adminAuth');
const { logInfo, shortHash } = require('../logging/logger');
const C = require('../rides/constants');

const OPERATIONS = ['credit', 'debit', 'correction', 'reversal'];
const CORRECTION_SIGNS = ['increase', 'decrease'];
const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function adjustDriverWallet({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request && request.data, {
    required: ['driverId', 'operation', 'reasonCode', 'note', 'idempotencyKey'],
    optional: ['amountCentavos', 'correctionSign', 'originalLedgerEntryId'],
  });
  const driverId = validateIdentifier(payload.driverId, 'driverId');
  const operation = validateEnum(payload.operation, OPERATIONS, 'operation');
  const reasonCode = validateNonEmptyString(payload.reasonCode, 'reasonCode').slice(0, 40);
  const note = validateNonEmptyString(payload.note, 'note').slice(0, 280); // mandatory human note
  validateIdempotencyKey(payload.idempotencyKey);

  const driverRef = db.collection(C.DRIVERS).doc(driverId);
  // Reversal id is keyed on the original entry so the SAME entry cannot be
  // reversed twice; other operations are keyed on the idempotencyKey.
  const originalLedgerEntryId = operation === 'reversal'
    ? validateIdentifier(payload.originalLedgerEntryId, 'originalLedgerEntryId')
    : null;
  const ledgerId = operation === 'reversal' ? `rev_${originalLedgerEntryId}` : `adj_${payload.idempotencyKey}`;
  const ledgerRef = db.collection(C.WALLET_TRANSACTIONS).doc(ledgerId);

  const out = await db.runTransaction(async (tx) => {
    const ledgerSnap = await tx.get(ledgerRef);
    if (ledgerSnap.exists) {
      const e = ledgerSnap.data() || {};
      return { replay: true, availableAfter: Number(e.availableAfterCentavos || 0), balanceAfter: Number(e.balanceAfterCentavos || 0), ledgerId };
    }
    const dSnap = await tx.get(driverRef);
    if (!dSnap.exists) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `driver not found: ${driverId}`, safeMetadata: { field: 'driverId' } });
    const d = dSnap.data() || {};
    const availableBefore = Number(d.walletAvailableCentavos || 0);
    const balanceBefore = Number(d.walletBalanceCentavos || 0);

    let amountCentavos;
    let availableDelta;
    let correctionSign = null;

    if (operation === 'reversal') {
      const origSnap = await tx.get(db.collection(C.WALLET_TRANSACTIONS).doc(originalLedgerEntryId));
      if (!origSnap.exists) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `ledger entry not found: ${originalLedgerEntryId}`, safeMetadata: { field: 'originalLedgerEntryId' } });
      const orig = origSnap.data() || {};
      // Only admin adjustment entries carry an explicit delta and are reversible;
      // ride holds/topups/captures are NOT reversible via a generic adjustment.
      if (orig.availableDeltaCentavos == null || orig.reversible !== true) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, { internalMessage: `ledger entry not reversible: ${originalLedgerEntryId}`, safeMetadata: { reason: 'not_reversible' } });
      }
      availableDelta = -Number(orig.availableDeltaCentavos || 0);
      amountCentavos = Math.abs(availableDelta);
    } else {
      amountCentavos = validatePositiveCentavos(payload.amountCentavos, 'amountCentavos');
      if (operation === 'credit') {
        availableDelta = amountCentavos;
      } else if (operation === 'debit') {
        availableDelta = -amountCentavos;
      } else {
        // correction: explicit signed compensating effect
        correctionSign = validateEnum(payload.correctionSign, CORRECTION_SIGNS, 'correctionSign');
        availableDelta = correctionSign === 'increase' ? amountCentavos : -amountCentavos;
      }
    }

    const availableAfter = availableBefore + availableDelta;
    const balanceAfter = balanceBefore + availableDelta;
    // Never negative, never silently clamped.
    if (availableAfter < 0 || balanceAfter < 0) {
      throw new AppError(ERROR_CODES.WALLET_INSUFFICIENT, { internalMessage: `adjustment would make wallet negative for ${driverId}`, safeMetadata: { operation } });
    }

    tx.set(driverRef, { walletAvailableCentavos: availableAfter, walletBalanceCentavos: balanceAfter, updatedAt: ts() }, { merge: true });

    const nowMs = clock.now();
    tx.set(ledgerRef, {
      type: `admin_${operation}`,
      operation,
      driverId,
      amountCentavos,
      availableDeltaCentavos: availableDelta,
      balanceDeltaCentavos: availableDelta,
      availableAfterCentavos: availableAfter,
      balanceAfterCentavos: balanceAfter,
      reasonCode,
      note,
      correctionSign,
      reversedEntryId: originalLedgerEntryId,
      idempotencyKey: payload.idempotencyKey,
      adminUid,
      // credit/debit/correction can themselves be reversed later; a reversal cannot.
      reversible: operation !== 'reversal',
      createdAtMs: nowMs,
      createdAt: ts(),
      traceId: context && context.traceId,
    });
    return { replay: false, availableBefore, balanceBefore, availableAfter, balanceAfter, amountCentavos, operation, ledgerId };
  });

  if (!out.replay) {
    await writeAuditLog(db, {
      actorUid: adminUid, actorType: 'admin', action: 'wallet_manual_adjustment', targetType: 'driver', targetId: driverId, reason: reasonCode,
      traceId: context && context.traceId,
      beforeSummary: { walletAvailableCentavos: out.availableBefore, walletBalanceCentavos: out.balanceBefore },
      afterSummary: { operation: out.operation, amountCentavos: out.amountCentavos, walletAvailableCentavos: out.availableAfter, walletBalanceCentavos: out.balanceAfter },
    }, clock);
    logInfo(context, 'wallet.admin_adjustment', { operation: out.operation, adminIdHash: shortHash(adminUid), targetUserIdHash: shortHash(driverId), ledgerEntryId: out.ledgerId, reasonCode, amountCentavos: out.amountCentavos, result: 'applied' });
  }
  return { driverId, operation, ledgerEntryId: out.ledgerId, replay: out.replay === true, walletAvailableCentavos: out.availableAfter, walletBalanceCentavos: out.balanceAfter };
}

module.exports = { adjustDriverWallet, WALLET_OPERATIONS: OPERATIONS };
