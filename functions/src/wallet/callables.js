// @ts-check
// Callable binding for the secure admin wallet-adjustment domain. Thin v2 onCall
// wrapped by the single error boundary; real logic lives in the pure,
// clock-injected handler so tests stay deterministic.

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { adjustDriverWallet } = require('./adminWallet');

const REGION = 'southamerica-east1';

module.exports = {
  adjustDriverWalletSecure: onCall(
    { region: REGION },
    withCallableBoundary('adjustDriverWalletSecure', (request, context) =>
      adjustDriverWallet({ db: admin.firestore(), request, context, clock: systemClock })
    )
  ),
};
