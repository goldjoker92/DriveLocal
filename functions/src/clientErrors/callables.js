// @ts-check
// Callable binding for authenticated client crash/non-fatal error reports.

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { reportClientError } = require('./reportClientError');

const REGION = 'southamerica-east1';

const reportClientErrorSecure = onCall(
  { region: REGION },
  withCallableBoundary('reportClientErrorSecure', (request, context) =>
    reportClientError({
      db: admin.firestore(),
      request,
      context,
      clock: systemClock,
    })
  )
);

module.exports = { reportClientErrorSecure };
