// Android notification channel ids must match the backend and be created before
// token retrieval. Channel sound/vibration settings are IMMUTABLE once Android
// has created the channel, so the legacy offer channel stays available as a safe
// fallback while the versioned sound channel opts verified devices in.
//
// Consequence observed in production: devices that created V2 from a build whose
// offer sound was not yet usable stayed on legacy_v1 forever, because a later
// build cannot change that channel's sound. V3 was introduced for that reason;
// V4 carries the repeated 30-second alert. Every sound change requires a new id.
export const NOTIFICATION_CHANNELS = Object.freeze({
  // Never remove or repurpose this id: old app versions and sound failures use it.
  RIDE_OFFERS: 'drivelocal-ride-offers',
  // Superseded ids stay declared because installed app versions can still
  // report them and the backend must keep routing to the channel they own.
  RIDE_OFFERS_V2: 'drivelocal-ride-offers-v2',
  RIDE_OFFERS_V3: 'drivelocal-ride-offers-v3',
  RIDE_OFFERS_V4: 'drivelocal-ride-offers-v4',
  RIDE_STATUS: 'drivelocal-ride-status',
  DRIVER_ARRIVAL: 'drivelocal-driver-arrival-v1',
});

export const NOTIFICATION_SOUNDS = Object.freeze({
  RIDE_OFFER: 'drivelocal_ride_offer.wav',
  DRIVER_ARRIVAL: 'drivelocal_driver_arrived.wav',
});

// Stored per native FCM token. The backend must treat every missing or unknown
// value as LEGACY_V1 so old installations keep their current notification path.
export const RIDE_OFFER_CHANNEL_CAPABILITIES = Object.freeze({
  LEGACY_V1: 'legacy_v1',
  // Installed older app versions still report V2/V3; the backend must route
  // each token to the versioned channel that exists on that device.
  CUSTOM_SOUND_V2: 'custom_sound_v2',
  CUSTOM_SOUND_V3: 'custom_sound_v3',
  CUSTOM_SOUND_V4: 'custom_sound_v4',
});

// Versioned offer channels preserve the existing vibration cadence. Changing
// the sound must not quietly change another driver-facing behavior.
export const RIDE_OFFER_VIBRATION_PATTERN = Object.freeze([
  0,
  250,
  250,
  250,
]);

export const DRIVER_ARRIVAL_VIBRATION_PATTERN = Object.freeze([
  0,
  400,
  150,
  650,
  150,
  400,
]);
