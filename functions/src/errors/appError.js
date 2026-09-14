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
  PAYMENT_NOT_REQUIRED: 'PAYMENT_NOT_REQUIRED',
  OUT_OF_SERVICE_AREA: 'OUT_OF_SERVICE_AREA',
  SERVICE_AREA_INACTIVE: 'SERVICE_AREA_INACTIVE',
  RIDE_IN_PROGRESS: 'RIDE_IN_PROGRESS',
  RIDE_ALREADY_ACCEPTED: 'RIDE_ALREADY_ACCEPTED',
  OFFER_EXPIRED: 'OFFER_EXPIRED',
  DRIVER_NOT_ELIGIBLE: 'DRIVER_NOT_ELIGIBLE',
  APP_UPDATE_REQUIRED: 'APP_UPDATE_REQUIRED',
  WALLET_INSUFFICIENT: 'WALLET_INSUFFICIENT',
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
  PAYMENT_NOT_REQUIRED: 'Pagamento ainda não é necessário no momento.',
  OUT_OF_SERVICE_AREA: 'Ainda não atendemos esta área. No momento o DriveLocal funciona apenas em Horizonte.',
  SERVICE_AREA_INACTIVE: 'Serviço indisponível nesta área no momento.',
  RIDE_IN_PROGRESS: 'Você já tem uma corrida em andamento.',
  RIDE_ALREADY_ACCEPTED: 'Esta corrida já foi aceita por outro motorista.',
  OFFER_EXPIRED: 'Esta oferta expirou.',
  DRIVER_NOT_ELIGIBLE: 'Você não está elegível para aceitar corridas no momento.',
  APP_UPDATE_REQUIRED: 'Atualize o DriveLocal para continuar recebendo corridas.',
  WALLET_INSUFFICIENT: 'Saldo DriveLocal insuficiente para aceitar esta corrida.',
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
  PAYMENT_NOT_REQUIRED: 'failed-precondition',
  OUT_OF_SERVICE_AREA: 'failed-precondition',
  SERVICE_AREA_INACTIVE: 'failed-precondition',
  RIDE_IN_PROGRESS: 'failed-precondition',
  RIDE_ALREADY_ACCEPTED: 'aborted',
  OFFER_EXPIRED: 'failed-precondition',
  DRIVER_NOT_ELIGIBLE: 'failed-precondition',
  APP_UPDATE_REQUIRED: 'failed-precondition',
  WALLET_INSUFFICIENT: 'failed-precondition',
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
