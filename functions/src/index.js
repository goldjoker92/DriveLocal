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

// BLOCK 03 — secure driver domain (admin-only approval, moderation, and manual
// subscription activation). No Mercado Pago, wallet movement, or ride logic.
const driverCallables = require('./drivers/callables');

exports.approveDriverSecure = driverCallables.approveDriverSecure;
exports.rejectDriverSecure = driverCallables.rejectDriverSecure;
exports.blockDriverSecure = driverCallables.blockDriverSecure;
exports.unblockDriverSecure = driverCallables.unblockDriverSecure;
exports.activateSubscriptionSecure = driverCallables.activateSubscriptionSecure;
