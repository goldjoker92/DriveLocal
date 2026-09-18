// @ts-check
// Shared ride-domain constants (server-authoritative). Money is integer
// centavos; distances are meters; durations are seconds; timestamps are epoch-ms.

module.exports = Object.freeze({
  // Collections.
  RIDE_REQUESTS: 'rideRequests',
  DRIVER_OFFERS: 'driverOffers',
  ACTIVE_RIDE_LOCATIONS: 'activeRideLocations',
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
  NON_FINAL_RIDE_STATUSES: Object.freeze([
    'searching', 'assigned', 'driver_arrived', 'in_progress', 'awaiting_payment', 'payment_marked_sent',
  ]),

  // Mirror of src/constants/notificationChannels.js. Android channel settings are
  // immutable after creation, so a new offer sound always needs a NEW id; older
  // ids stay routable for app versions still installed in the field.
  NOTIFICATION_CHANNELS: Object.freeze({
    // Immutable legacy id: every old/missing capability must continue here.
    RIDE_OFFERS: 'drivelocal-ride-offers',
    RIDE_OFFERS_V2: 'drivelocal-ride-offers-v2',
    RIDE_OFFERS_V3: 'drivelocal-ride-offers-v3',
    RIDE_OFFERS_V4: 'drivelocal-ride-offers-v4',
    RIDE_STATUS: 'drivelocal-ride-status',
    DRIVER_ARRIVAL: 'drivelocal-driver-arrival-v1',
  }),

  NOTIFICATION_SOUNDS: Object.freeze({
    RIDE_OFFER: 'drivelocal_ride_offer.wav',
    DRIVER_ARRIVAL: 'drivelocal_driver_arrived.wav',
  }),

  RIDE_OFFER_CHANNEL_CAPABILITIES: Object.freeze({
    LEGACY_V1: 'legacy_v1',
    // App versions still installed in the field can report V2/V3. Keep routing
    // every token to the versioned channel that exists on its device.
    CUSTOM_SOUND_V2: 'custom_sound_v2',
    CUSTOM_SOUND_V3: 'custom_sound_v3',
    CUSTOM_SOUND_V4: 'custom_sound_v4',
  }),

  DRIVER_ARRIVAL_VIBRATION_PATTERN: Object.freeze([
    0,
    400,
    150,
    650,
    150,
    400,
  ]),

  NOTIFICATION_EVENT: Object.freeze({
    OFFER_CREATED: 'offer_created',
    RIDE_ASSIGNED: 'ride_assigned',
    // Sent when a search ends with nobody found. Before continuous search the
    // refusal was instant and the passenger was still looking at his screen;
    // now he waits up to SEARCH_TTL_SECONDS and may well have put the phone
    // away, so the outcome has to reach him.
    RIDE_NO_DRIVER: 'ride_no_driver',
    RIDE_ARRIVED: 'ride_arrived',
    RIDE_STARTED: 'ride_started',
    RIDE_AWAITING_PAYMENT: 'ride_awaiting_payment',
    RIDE_PAYMENT_MARKED_SENT: 'ride_payment_marked_sent',
    RIDE_COMPLETED: 'ride_completed',
    RIDE_CANCELLED: 'ride_cancelled',
    RIDE_DISPUTED: 'ride_disputed',
    RIDE_QUICK_MESSAGE: 'ride_quick_message',
    // Admin message to the whole driver fleet. Carries its own copy instead of
    // a static presentation, and rides on the STATUS channel, never the offer one.
    DRIVER_BROADCAST: 'driver_broadcast',
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

  REASON: Object.freeze({
    NO_ELIGIBLE_DRIVERS: 'NO_ELIGIBLE_DRIVERS',
    // Nobody reachable on this wave, but the search window is still open.
    SEARCH_CONTINUES: 'SEARCH_CONTINUES',
    OFFER_BATCH_FAILED: 'OFFER_BATCH_FAILED',
    OFFERS_CREATED: 'OFFERS_CREATED',
  }),

  // Horizonte progressive launch policy. Each individual offer remains valid
  // for 30 seconds while the passenger search has one clear 90-second ceiling.
  // Radius expansion is cumulative: drivers already offered the ride are never
  // notified twice, but drivers coming online during the window remain eligible.
  OFFER_TTL_SECONDS: 30,
  SEARCH_TTL_SECONDS: 90,
  MAX_CANDIDATES: 100,
  DEFAULT_SEARCH_RADIUS_METERS: 15_000,
  DISPATCH_WAVE_PLAN_VERSION: 'horizonte-progressive-v1',
  DISPATCH_WAVES: Object.freeze([
    Object.freeze({ index: 0, offsetMs: 0, radiusMeters: 3_000 }),
    Object.freeze({ index: 1, offsetMs: 15_000, radiusMeters: 6_000 }),
    Object.freeze({ index: 2, offsetMs: 30_000, radiusMeters: 10_000 }),
    Object.freeze({ index: 3, offsetMs: 45_000, radiusMeters: 12_000 }),
    Object.freeze({ index: 4, offsetMs: 60_000, radiusMeters: 15_000 }),
  ]),
  // Launch reality: the work session is refreshed ONLY by a published GPS point
  // (see driverLocationTracking.driverLocationUpdate). Any Android battery
  // restriction that suspends the location task therefore silently removes a
  // working driver from dispatch while his app still shows "disponível".
  // Until the client publishes a GPS-independent heartbeat, these windows are
  // deliberately generous: in a town the size of Horizonte a 15-minute-old point
  // is still useful, the driver can always decline, and losing a real driver
  // costs far more than offering him a ride he refuses.
  LOCATION_MAX_AGE_MS: 15 * 60 * 1000,
  AVAILABILITY_SESSION_MAX_AGE_MS: 20 * 60 * 1000,
  // A driver whose lease merely expired is NOT logged out: his app republishes a
  // point and he becomes dispatchable again on his own. Only a session with no
  // sign of life for this much longer is treated as abandoned and closed, so a
  // tunnel, an indoor stop or a short doze never ends a working driver's shift.
  WORK_SESSION_ABANDONED_MAX_AGE_MS: 45 * 60 * 1000,

  // Cloud Tasks runs the sub-minute cadence. The one-minute scheduled sweep is
  // deliberately only a recovery mechanism when a task is delayed or unavailable.
  DISPATCH_WAVE_INTERVAL_MS: 15 * 1000,
  // Drivers already offered this ride, kept on the ride document so a wave costs
  // no extra reads. Bounded to stay far below the 1 MiB document limit.
  MAX_TRACKED_OFFERED_DRIVERS: 200,

  MIN_WALLET_BALANCE_CENTAVOS: 300,

  VEHICLE_TYPES: Object.freeze(['moto', 'car']),
});
