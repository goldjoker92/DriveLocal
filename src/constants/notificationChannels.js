// Android notification channel ids must match the backend and be created before
// token retrieval. Channel sound/vibration settings are immutable after Android
// creates them, so the legacy offer channel stays available as a safe fallback
// while V2 opts verified devices into the DriveLocal sound.
export const NOTIFICATION_CHANNELS = Object.freeze({
  // Never remove or repurpose this id: old app versions and V2 failures use it.
  RIDE_OFFERS: 'drivelocal-ride-offers',
  RIDE_OFFERS_V2: 'drivelocal-ride-offers-v2',
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
  CUSTOM_SOUND_V2: 'custom_sound_v2',
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
