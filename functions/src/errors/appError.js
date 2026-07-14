// @ts-check
// Stable, safe error system for DriveLocal Cloud Functions.
//   - stable machine-readable code (never localized; safe to switch on / log);
//   - safe PT-BR client message (no internals, no secrets);
//   - callable (HttpsError) status mapping;
//   - internal cause retained for LOGS ONLY (never returned to the client);
//   - retryable flag; optional safe metadata (must never carry secrets/PII).

const ERROR_CODES = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  ADMIN_REQUIRED: 'ADMIN_REQUIRED',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  CONFIGURATION_MISSING: 'CONFIGURATION_MISSING',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
});

// Safe PT-BR client messages (no internal detail, no secrets).
const PT_BR_MESSAGES = Object.freeze({
  UNAUTHENTICATED: 'Você precisa entrar para continuar.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  ADMIN_REQUIRED: 'Ação disponível apenas para administradores.',
  INVALID_ARGUMENT: 'Dados inválidos. Verifique e tente novamente.',
  INVALID_STATE_TRANSITION: 'Esta operação não é permitida no estado atual.',
  CONFIGURATION_MISSING: 'Serviço temporariamente indisponível. Tente novamente mais tarde.',
  IDEMPOTENCY_CONFLICT: 'Esta solicitação já foi processada de outra forma.',
  INTERNAL_ERROR: 'Ocorreu um erro. Tente novamente mais tarde.',
  PROVIDER_TIMEOUT: 'O serviço demorou a responder. Tente novamente.',
  PROVIDER_UNAVAILABLE: 'Serviço indisponível no momento. Tente novamente.',
});

// Firebase callable (HttpsError) status per stable code.
const CALLABLE_STATUS = Object.freeze({
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'permission-denied',
  ADMIN_REQUIRED: 'permission-denied',
  INVALID_ARGUMENT: 'invalid-argument',
  INVALID_STATE_TRANSITION: 'failed-precondition',
  CONFIGURATION_MISSING: 'failed-precondition',
  IDEMPOTENCY_CONFLICT: 'aborted',
  INTERNAL_ERROR: 'internal',
  PROVIDER_TIMEOUT: 'deadline-exceeded',
  PROVIDER_UNAVAILABLE: 'unavailable',
});

// Codes retryable by default (provider transient failures).
const DEFAULT_RETRYABLE = Object.freeze({
  PROVIDER_TIMEOUT: true,
  PROVIDER_UNAVAILABLE: true,
});

class AppError extends Error {
  /**
   * @param {string} code one of ERROR_CODES (unknown -> INTERNAL_ERROR)
   * @param {{internalMessage?:string, cause?:any, retryable?:boolean, safeMetadata?:object}} [options]
   */
  constructor(code, options = {}) {
    const stableCode = ERROR_CODES[code] ? code : ERROR_CODES.INTERNAL_ERROR;
    super(options.internalMessage || stableCode);
    this.name = 'AppError';
    this.code = stableCode;
    this.clientMessage = PT_BR_MESSAGES[stableCode];
    this.callableStatus = CALLABLE_STATUS[stableCode];
    this.retryable =
      options.retryable != null ? options.retryable === true : DEFAULT_RETRYABLE[stableCode] === true;
    // internalCause is for structured logs ONLY — never serialized to the client.
    this.internalCause = options.cause || null;
    // safeMetadata may reach the client; callers must keep it free of secrets/PII.
    this.safeMetadata =
      options.safeMetadata && typeof options.safeMetadata === 'object' ? options.safeMetadata : undefined;
  }

  // Client-facing payload. NEVER includes stack, internalCause, or internalMessage.
  toClient() {
    const out = { code: this.code, message: this.clientMessage, retryable: this.retryable };
    if (this.safeMetadata) out.metadata = this.safeMetadata;
    return out;
  }

  static isAppError(e) {
    return e instanceof AppError;
  }

  // Normalizes any thrown value to an AppError. Known AppErrors pass through;
  // anything else becomes INTERNAL_ERROR with the original retained as cause
  // (server-side only).
  static from(e) {
    if (e instanceof AppError) return e;
    return new AppError(ERROR_CODES.INTERNAL_ERROR, {
      internalMessage: e && e.message ? String(e.message) : 'Unknown error',
      cause: e,
    });
  }
}

module.exports = { AppError, ERROR_CODES, PT_BR_MESSAGES, CALLABLE_STATUS };
