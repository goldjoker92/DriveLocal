// @ts-check
// Single callable error boundary for DriveLocal Cloud Functions.
//   - creates/propagates a traceId + logger context;
//   - runs the handler;
//   - maps AppError -> safe HttpsError; any unknown error -> INTERNAL_ERROR;
//   - logs the sanitized failure exactly once;
//   - NEVER returns a stack trace or internal cause to the client.

const { HttpsError } = require('firebase-functions/v2/https');
const { AppError } = require('./appError');
const { createLoggerContext, logError } = require('../logging/logger');

/**
 * Wraps a callable handler.
 * @param {string} functionName
 * @param {(request:object, context:object)=>Promise<*>|*} handler
 * @param {{environment?:string}} [options]
 */
function withCallableBoundary(functionName, handler, options = {}) {
  return async (request) => {
    const context = createLoggerContext({
      functionName,
      environment: options.environment,
      actorType: request && request.auth ? 'user' : 'anonymous',
      actorUid: request && request.auth ? request.auth.uid : undefined,
    });
    try {
      return await handler(request, context);
    } catch (err) {
      const appError = AppError.from(err);
      // Log once, sanitized. internalCause/message stay server-side only.
      logError(context, 'function_error', {
        errorCode: appError.code,
        retryable: appError.retryable,
        internalMessage: appError.message,
      });
      // toClient() carries only code/message/retryable/safeMetadata — no stack.
      throw new HttpsError(appError.callableStatus, appError.clientMessage, appError.toClient());
    }
  };
}

module.exports = { withCallableBoundary };
