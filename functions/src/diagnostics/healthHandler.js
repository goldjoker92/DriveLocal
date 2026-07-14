// @ts-check
// Pure diagnostic handler (no firebase-functions import, fully unit-testable).
//
// Returns ONLY safe health metadata. It is DISABLED in production by default:
// an unrestricted production diagnostic endpoint is forbidden. (A future
// admin-gated production diagnostic may be added in BLOCK 03/04.)
// It never returns secrets, environment variables, Firebase config, or data.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { ENVIRONMENTS, resolveEnvironment } = require('../config/environment');
const { systemClock } = require('../time/clock');
const { logInfo } = require('../logging/logger');

const FUNCTION_VERSION = '02-functions-debug-foundation';

/**
 * @param {object} request callable request (may carry auth)
 * @param {object} context logger context ({ traceId, ... })
 * @param {{environment?:string, clock?:{now:()=>number}}} [deps] injected for tests
 */
function healthHandler(request, context, deps = {}) {
  const environment = deps.environment || resolveEnvironment();
  const clock = deps.clock || systemClock;

  if (environment === ENVIRONMENTS.PRODUCTION) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      internalMessage: 'diagnostic is disabled in production by default',
    });
  }

  const nowMs = clock.now();
  const safe = {
    status: 'ok',
    environment,
    functionVersion: FUNCTION_VERSION,
    serverTimeMs: nowMs,
    serverTimeIso: new Date(nowMs).toISOString(),
    traceId: context.traceId,
  };
  logInfo(context, 'diagnostic_health', { result: 'ok', environment });
  return safe;
}

module.exports = { healthHandler, FUNCTION_VERSION };
