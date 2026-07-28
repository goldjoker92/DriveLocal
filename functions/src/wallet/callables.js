// @ts-check
// Callable bindings for the wallet domain. Admin adjustments and driver-owned
// read projections stay separate; raw ledger/payment collections remain server-only.

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { withCallableBoundary } = require('../errors/boundary');
const { systemClock } = require('../time/clock');
const { adjustDriverWallet } = require('./adminWallet');
const { getDriverWalletSnapshot } = require('./driverWalletSnapshot');

const REGION = 'southamerica-east1';

module.exports = {
  adjustDriverWalletSecure: onCall(
    { region: REGION },
    withCallableBoundary('adjustDriverWalletSecure', (request, context) =>
      adjustDriverWallet({ db: admin.firestore(), request, context, clock: systemClock })
    )
  ),
  getDriverWalletSnapshot: onCall(
    { region: REGION },
    withCallableBoundary('getDriverWalletSnapshot', (request, context) =>
      getDriverWalletSnapshot({ db: admin.firestore(), request, context, clock: systemClock })
    )
  ),
};
