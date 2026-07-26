// @ts-check
// Authenticated, privacy-safe client error ingestion.
//
// Reports are stored in a server-only collection. A deterministic ten-minute
// bucket groups repeated crashes from the same actor/fingerprint instead of
// creating an unbounded document storm during a crash loop.

const admin = require('firebase-admin');

const { AppError, ERROR_CODES } = require('../errors/appError');
const { logWarning, shortHash } = require('../logging/logger');
const {
  normalizeClientErrorPayload,
  buildServerFingerprint,
  buildReportDocumentId,
} = require('./reportPolicy');

const COLLECTION = 'clientErrorReports';

async function reportClientError({ db, request, context, clock }) {
  const actorUid = request?.auth?.uid;
  if (!actorUid) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'client error report requires authentication',
    });
  }

  const nowMs = Number(clock.now());
  const report = normalizeClientErrorPayload(request?.data, nowMs);
  const actorHash = shortHash(actorUid);
  const fingerprint = buildServerFingerprint(report);
  const reportId = buildReportDocumentId({ actorHash, fingerprint, nowMs });
  const reportRef = db.collection(COLLECTION).doc(reportId);

  await db.runTransaction(async (tx) => {
    const existingSnapshot = await tx.get(reportRef);
    const existing = existingSnapshot.exists ? existingSnapshot.data() || {} : {};
    const occurrenceCount = Math.max(0, Number(existing.occurrenceCount || 0)) + 1;

    const shared = {
      lastSeenAtMs: nowMs,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      occurrenceCount,
      severity: report.severity,
      isFatal: report.isFatal,
      appVersion: report.appVersion,
      environment: report.environment,
      platform: report.platform,
    };

    if (existingSnapshot.exists) {
      tx.set(reportRef, shared, { merge: true });
      return;
    }

    tx.create(reportRef, {
      ...shared,
      reportId,
      fingerprint,
      actorUid,
      actorHash,
      eventName: report.eventName,
      source: report.source,
      errorName: report.errorName,
      message: report.message,
      stack: report.stack,
      componentStack: report.componentStack,
      route: report.route,
      role: report.role,
      rideRef: report.rideRef,
      paymentRef: report.paymentRef,
      clientTraceRef: report.traceRef,
      occurredAtMs: report.occurredAtMs,
      firstSeenAtMs: nowMs,
      firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  // Never include error message or stack in normal logs. Operators can open the
  // private report document when the fingerprint/route indicates investigation.
  logWarning(
    { ...context, actorUid: undefined, actorHash },
    'client_error.reported',
    {
      reportRef: reportId,
      fingerprint,
      eventName: report.eventName,
      errorName: report.errorName,
      severity: report.severity,
      isFatal: report.isFatal,
      route: report.route,
      appVersion: report.appVersion,
      platform: report.platform,
    }
  );

  return {
    accepted: true,
    reportRef: reportId,
    fingerprint,
  };
}

module.exports = {
  COLLECTION,
  reportClientError,
};
