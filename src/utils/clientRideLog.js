// Lightweight client-side ride diagnostics.
//
// This module intentionally avoids logging identifiers, coordinates, addresses,
// phone numbers, CPF, Pix keys or tokens. It exists so screens can emit useful
// development breadcrumbs without leaking passenger/driver data.

const SAFE_DETAIL_KEYS = new Set([
  'role',
  'screen',
  'action',
  'status',
  'vehicleType',
  'errorCode',
  'source',
]);

function safeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};

  return Object.entries(details).reduce((safe, [key, value]) => {
    if (!SAFE_DETAIL_KEYS.has(key)) return safe;
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      safe[key] = value;
    }
    return safe;
  }, {});
}

export function logRideClientEvent(eventName, details) {
  const event = typeof eventName === 'string' && eventName.trim()
    ? eventName.trim()
    : 'unknown_event';

  const payload = {
    scope: 'ride_client',
    event,
    ...safeDetails(details),
  };

  if (__DEV__) {
    console.log('[DriveLocal][RIDE_CLIENT]', JSON.stringify(payload));
  }

  return payload;
}
