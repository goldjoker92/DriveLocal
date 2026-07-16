// @ts-check
// Shared ride-domain constants (server-authoritative). Money is integer
// centavos; distances are meters; durations are seconds; timestamps are epoch-ms.

module.exports = Object.freeze({
  // Collections.
  RIDE_REQUESTS: 'rideRequests',
  DRIVER_OFFERS: 'driverOffers',
  DRIVERS: 'drivers',
  PASSENGERS: 'passengers',
  PRIVATE_DRIVER_DATA: 'privateDriverData',
  CITY_PUBLIC_CONFIG: 'cityPublicConfig',
  WALLET_TRANSACTIONS: 'walletTransactions',
  COUNTERS: 'counters',
  NOTIFICATION_EVENTS: 'notificationEvents',
  NOTIFICATION_TOKENS: 'notificationTokens',

  DEFAULT_SERVICE_AREA_ID: 'HORIZONTE_CE_BR',

  // Ride lifecycle statuses owned by the backend.
  RIDE_STATUS: Object.freeze({
    SEARCHING: 'searching',
    ASSIGNED: 'assigned',
    NO_DRIVER_AVAILABLE: 'no_driver_available',
    DISPATCH_FAILED: 'dispatch_failed',
    DRIVER_ARRIVED: 'driver_arrived',
    IN_PROGRESS: 'in_progress',
    AWAITING_PAYMENT: 'awaiting_payment',
    PAYMENT_MARKED_SENT: 'payment_marked_sent',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    DISPUTED: 'disputed',
  }),
  // A passenger may not open a new ride while one of these is in progress.
  NON_FINAL_RIDE_STATUSES: Object.freeze([
    'searching', 'assigned', 'driver_arrived', 'in_progress', 'awaiting_payment', 'payment_marked_sent',
  ]),

  // Android notification channels (created client-side before token retrieval).
  NOTIFICATION_CHANNELS: Object.freeze({
    RIDE_OFFERS: 'drivelocal-ride-offers',
    RIDE_STATUS: 'drivelocal-ride-status',
  }),

  // notificationEvents.eventType values (also used for deterministic dedupe ids).
  NOTIFICATION_EVENT: Object.freeze({
    OFFER_CREATED: 'offer_created',
    RIDE_ARRIVED: 'ride_arrived',
    RIDE_STARTED: 'ride_started',
    RIDE_AWAITING_PAYMENT: 'ride_awaiting_payment',
    RIDE_PAYMENT_MARKED_SENT: 'ride_payment_marked_sent',
    RIDE_COMPLETED: 'ride_completed',
    RIDE_CANCELLED: 'ride_cancelled',
    RIDE_DISPUTED: 'ride_disputed',
  }),

  NOTIFICATION_STATUS: Object.freeze({
    PENDING: 'pending',
    SENT: 'sent',
    PARTIALLY_FAILED: 'partially_failed',
    FAILED: 'failed',
  }),

  OFFER_STATUS: Object.freeze({
    OFFERED: 'offered',
    ACCEPTED: 'accepted',
    CLOSED: 'closed',
    EXPIRED: 'expired',
  }),

  // Stable reason codes surfaced in logs / dispatch results (never localized).
  REASON: Object.freeze({
    NO_ELIGIBLE_DRIVERS: 'NO_ELIGIBLE_DRIVERS',
    OFFER_BATCH_FAILED: 'OFFER_BATCH_FAILED',
    OFFERS_CREATED: 'OFFERS_CREATED',
  }),

  // Timing / bounds (defaults; the safe city config may override some).
  OFFER_TTL_SECONDS: 15, // targeted offer lifetime from server time
  SEARCH_TTL_SECONDS: 90, // MVP single-wave search window (§F: ~70-90s)
  MAX_CANDIDATES: 25, // configurable HARD cap; never read an unlimited collection
  DEFAULT_SEARCH_RADIUS_METERS: 5000,
  LOCATION_MAX_AGE_MS: 2 * 60 * 1000, // driver location must be this recent

  // Wallet gate for standard (post-promotion) drivers.
  MIN_WALLET_BALANCE_CENTAVOS: 300, // must be strictly greater than R$3,00

  VEHICLE_TYPES: Object.freeze(['moto', 'car']),
});
