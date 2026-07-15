// @ts-check
// Fixed server-owned constants for the Mercado Pago Pix payment domain.
// All money is integer centavos; conversion to BRL decimal happens ONLY at the
// provider boundary (see mercadoPago.js). The client never supplies plan prices
// or arbitrary top-up amounts — these are authoritative.

module.exports = Object.freeze({
  // Server-only Firestore collections (see backend/firebase/rules/firestore.rules).
  PAYMENT_REQUESTS: 'paymentRequests',
  WALLET_TRANSACTIONS: 'walletTransactions',
  SUBSCRIPTION_PAYMENTS: 'subscriptionPayments',

  PROVIDER: 'mercado_pago',
  CURRENCY: 'BRL',

  // Payment purposes accepted from an authenticated driver.
  PURPOSES: Object.freeze(['driver_subscription', 'wallet_topup']),

  // Normalized DriveLocal payment states (provider states map into these).
  STATUS: Object.freeze({
    PENDING: 'pending',
    PAID: 'paid',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    MANUAL_REVIEW: 'manual_review',
  }),

  // Server-approved pilot wallet top-up amounts (integer centavos). No other
  // amount — arbitrary or negative — is ever accepted from the client.
  ALLOWED_TOPUP_CENTAVOS: Object.freeze([1000, 2000, 3000, 5000]),

  // A Pix order is short-lived; used to compute expiresAt when the provider does
  // not return an explicit expiration.
  ORDER_EXPIRATION_MS: 30 * 60 * 1000, // 30 minutes

  // External request timeout for the provider boundary.
  PROVIDER_TIMEOUT_MS: 10 * 1000,
});
