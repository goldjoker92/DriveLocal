// Android notification channel ids must match the backend and be created before
// token retrieval. Channel sound/vibration settings are IMMUTABLE once Android
// has created the channel, so the legacy offer channel stays available as a safe
// fallback while the versioned sound channel opts verified devices in.
//
// Consequence observed in production: devices that created V2 from a build whose
// offer sound was not yet usable stayed on legacy_v1 forever, because a later
// build cannot change that channel's sound. V3 exists for exactly that reason.
// Any future change to an offer sound REQUIRES a new id — never edit one in place.
export const NOTIFICATION_CHANNELS = Object.freeze({
  // Never remove or repurpose this id: old app versions and sound failures use it.
  RIDE_OFFERS: 'drivelocal-ride-offers',
  // Superseded by V3. Kept so the app can clean it up and so the backend can
  // still route offers for app versions that are still installed and report V2.
  RIDE_OFFERS_V2: 'drivelocal-ride-offers-v2',
  RIDE_OFFERS_V3: 'drivelocal-ride-offers-v3',
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
  // Still reported by installed older app versions: the backend must keep
  // routing those tokens to the V2 channel, which works on their devices.
  CUSTOM_SOUND_V2: 'custom_sound_v2',
  CUSTOM_SOUND_V3: 'custom_sound_v3',
});

// V2 intentionally preserves the existing offer vibration cadence. This change
// improves the sound without quietly changing another driver-facing behavior.
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
