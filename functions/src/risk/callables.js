// @ts-check
// Cloud Functions bindings for admin analytics and review queues.

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { getAdminBusinessAnalytics } = require('./adminAnalytics');
const { listAdminRiskCases, decideAdminRiskCase } = require('./adminCases');

const REGION = 'southamerica-east1';

module.exports = {
  getAdminBusinessAnalyticsSecure: onCall(
    { region: REGION },
    withCallableBoundary('getAdminBusinessAnalyticsSecure', (request, context) =>
      getAdminBusinessAnalytics({
        db: admin.firestore(),
        request,
        context,
        clock: systemClock,
      })
    )
  ),
  listAdminRiskCasesSecure: onCall(
    { region: REGION },
    withCallableBoundary('listAdminRiskCasesSecure', (request, context) =>
      listAdminRiskCases({
        db: admin.firestore(),
        request,
        context,
        clock: systemClock,
      })
    )
  ),
  decideAdminRiskCaseSecure: onCall(
    { region: REGION },
    withCallableBoundary('decideAdminRiskCaseSecure', (request, context) =>
      decideAdminRiskCase({
        db: admin.firestore(),
        request,
        context,
        clock: systemClock,
      })
    )
  ),
};
