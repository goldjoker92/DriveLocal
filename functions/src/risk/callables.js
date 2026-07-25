// @ts-check
// Thin Cloud Functions bindings for launch antifraud/admin analytics.

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { getAdminBusinessAnalytics } = require('./adminAnalytics');

const REGION = 'southamerica-east1';

module.exports = {
  getAdminBusinessAnalyticsSecure: onCall(
    { region: REGION },
    withCallableBoundary('getAdminBusinessAnalyticsSecure', (request, context) =>
      getAdminBusinessAnalytics({ db: admin.firestore(), request, context, clock: systemClock })
    )
  ),
};
