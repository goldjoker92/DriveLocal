// @ts-check
// DriveLocal Cloud Functions entrypoint (JavaScript, gen 2).
//
// Initializes Firebase Admin exactly once, then exports callable functions.
// BLOCK 02 ships only the observability/debugging foundation plus one safe
// diagnostic. No Mercado Pago, wallet, approval, ride, or notification logic.

const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const { health } = require('./diagnostics/health');

exports.health = health;
