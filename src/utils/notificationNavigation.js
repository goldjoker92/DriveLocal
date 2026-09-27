// Pure notification-navigation contract. Keeps notification taps deterministic
// and prevents arbitrary routes or missing ride context from reaching screens.

export const ALLOWED_NOTIFICATION_ROUTES = new Set([
  '/ride-request',
  '/active-ride',
  '/driver-home',
  '/driver-accepted',
  '/searching',
  '/pix-payment',
  '/ride-completed',
  '/passenger-home',
]);

const ROUTES_REQUIRING_RIDE_ID = new Set([
  '/active-ride',
  '/driver-accepted',
  '/searching',
  '/pix-payment',
  '/ride-completed',
]);

export function notificationDataFromResponse(response) {
  const content = response?.notification?.request?.content;
  const data = content?.data || {};
  return {
    notificationId: data.notificationId ? String(data.notificationId) : null,
    route: data.route ? String(data.route) : null,
    rideId: data.rideId ? String(data.rideId) : null,
    offerId: data.offerId ? String(data.offerId) : null,
    eventType: data.eventType ? String(data.eventType) : null,
  };
}

export function buildNotificationRouteTarget(data) {
  if (!data?.route || !ALLOWED_NOTIFICATION_ROUTES.has(data.route)) return null;
  if (ROUTES_REQUIRING_RIDE_ID.has(data.route) && !data.rideId) return null;

  // Keep server routes compatible with installed legacy builds. Only current
  // clients turn a ride-message notification into a direct conversation entry.
  const isMessage = ['ride_message', 'ride_quick_message'].includes(data.eventType);
  const messageRoute = data.route === '/active-ride' ? '/driver-ride-messages'
    : data.route === '/driver-accepted' ? '/passenger-ride-messages' : null;
  const targetRoute = isMessage && data.rideId && messageRoute ? messageRoute : data.route;
  const params = {};
  if (data.rideId) params.rideId = data.rideId;
  if (data.offerId) params.offerId = data.offerId;
  if (data.eventType) params.eventType = data.eventType;

  return Object.keys(params).length > 0
    ? { pathname: targetRoute, params }
    : targetRoute;
}
