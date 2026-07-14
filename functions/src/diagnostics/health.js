// @ts-check
// Callable wrapper for the diagnostic handler. The pure logic lives in
// healthHandler.js; here we only bind it to a v2 callable through the single
// error boundary. Emulator/dev safe; disabled in production (see healthHandler).

const { onCall } = require('firebase-functions/v2/https');
const { withCallableBoundary } = require('../errors/boundary');
const { healthHandler } = require('./healthHandler');

const health = onCall(
  { region: 'southamerica-east1' },
  withCallableBoundary('health', (request, context) => healthHandler(request, context))
);

module.exports = { health };
