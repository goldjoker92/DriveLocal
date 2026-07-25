// @ts-check
// Admin-only bounded analytics read. This deliberately computes aggregates on the
// server so raw driver/passenger records and exact locations are never returned to
// the admin mobile UI. Launch caps prevent accidental unbounded collection scans.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape } = require('../validation/validators');
const { requireAdmin } = require('../auth/adminAuth');
const { logInfo, shortHash } = require('../logging/logger');
const paymentC = require('../payments/constants');
const rideC = require('../rides/constants');
const riskC = require('./constants');
const { buildAdminAnalytics } = require('./analytics');
const { aggregateRiskCases } = require('./caseAnalytics');

const LIMITS = Object.freeze({
  rides: 2500,
  drivers: 1500,
  payments: 2000,
  alerts: 500,
  riskCases: 500,
  supplySnapshots: 2200,
});
const ALLOWED_RANGE_DAYS = new Set([1, 7, 30, 90]);

function docs(snapshot) {
  return snapshot.docs.map((document) => ({ id: document.id, ...(document.data() || {}) }));
}

async function getAdminBusinessAnalytics({ db, request, context, clock }) {
  const adminUid = await requireAdmin(db, request);
  const payload = assertShape(request?.data || {}, { optional: ['rangeDays'] });
  const rangeDays = payload.rangeDays == null ? 30 : Number(payload.rangeDays);
  if (!ALLOWED_RANGE_DAYS.has(rangeDays)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `unsupported analytics range: ${payload.rangeDays}`,
      safeMetadata: { field: 'rangeDays' },
    });
  }

  const nowMs = Number(clock.now());
  const startMs = nowMs - rangeDays * 86400000;
  const [ridesSnap, driversSnap, paymentsSnap, alertsSnap, casesSnap, supplySnap] = await Promise.all([
    db.collection(rideC.RIDE_REQUESTS)
      .where('createdAtMs', '>=', startMs)
      .limit(LIMITS.rides)
      .get(),
    db.collection(rideC.DRIVERS).limit(LIMITS.drivers).get(),
    db.collection(paymentC.PAYMENT_REQUESTS)
      .where('createdAtMs', '>=', startMs)
      .limit(LIMITS.payments)
      .get(),
    db.collection(riskC.COLLECTIONS.FINANCIAL_ALERTS)
      .where('createdAtMs', '>=', startMs)
      .limit(LIMITS.alerts)
      .get(),
    db.collection(riskC.COLLECTIONS.FRAUD_CASES)
      .limit(LIMITS.riskCases)
      .get(),
    db.collection(riskC.COLLECTIONS.OPERATIONAL_SNAPSHOTS)
      .where('createdAtMs', '>=', startMs)
      .limit(LIMITS.supplySnapshots)
      .get(),
  ]);

  const result = buildAdminAnalytics({
    rides: docs(ridesSnap),
    drivers: docs(driversSnap),
    payments: docs(paymentsSnap),
    alerts: docs(alertsSnap),
    supplySnapshots: docs(supplySnap),
    nowMs,
    rangeDays,
  });
  result.riskCases = aggregateRiskCases(docs(casesSnap));

  result.truncated = {
    rides: ridesSnap.size >= LIMITS.rides,
    drivers: driversSnap.size >= LIMITS.drivers,
    payments: paymentsSnap.size >= LIMITS.payments,
    alerts: alertsSnap.size >= LIMITS.alerts,
    riskCases: casesSnap.size >= LIMITS.riskCases,
    supplySnapshots: supplySnap.size >= LIMITS.supplySnapshots,
  };

  logInfo(context, 'admin.analytics.generated', {
    operation: 'admin_analytics',
    adminIdHash: shortHash(adminUid),
    result: 'generated',
    count: ridesSnap.size,
    windowDays: rangeDays,
  });
  return result;
}

module.exports = { getAdminBusinessAnalytics, ANALYTICS_LIMITS: LIMITS };
