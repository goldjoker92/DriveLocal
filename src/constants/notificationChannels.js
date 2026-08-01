// Android notification channel ids must match the backend and be created before
// token retrieval. Arrival uses its own immutable channel version because Android
// does not allow an app to replace a channel's sound or vibration after creation.
export const NOTIFICATION_CHANNELS = Object.freeze({
  RIDE_OFFERS: 'drivelocal-ride-offers',
  RIDE_STATUS: 'drivelocal-ride-status',
  DRIVER_ARRIVAL: 'drivelocal-driver-arrival-v1',
});

export const NOTIFICATION_SOUNDS = Object.freeze({
  DRIVER_ARRIVAL: 'drivelocal_driver_arrived.wav',
});

export const DRIVER_ARRIVAL_VIBRATION_PATTERN = Object.freeze([
  0,
  400,
  150,
  650,
  150,
  400,
]);
