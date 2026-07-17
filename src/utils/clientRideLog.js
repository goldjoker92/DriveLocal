import { APP_ENVIRONMENT } from '../config/runtimeEnvironment';

// Structured client-side ride traces for development builds.
//
// These logs are intentionally rich enough to debug the whole passenger flow
// (request -> quote -> dispatch -> assignment -> payment), while still excluding
// exact coordinates, street labels, Pix payloads, phone numbers, tokens and
// counterparty identifiers. Production builds do not emit these traces.
const DEV_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__ === true;
const CLIENT_RIDE_LOGS_ENABLED = APP_ENVIRONMENT === 'development' || DEV_RUNTIME;

function safeString(value, max = 120) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function safeNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined)
  );
}

/**
 * Returns a privacy-safe but operationally complete ride snapshot for Metro logs.
 * Field names are included so a missing backend projection is immediately visible.
 */
export function sanitizeRideForClientLog(ride) {
  if (!ride || typeof ride !== 'object') return null;

  return compact({
    rideId: safeString(ride.rideId || ride.id),
    traceId: safeString(ride.traceId),
    status: safeString(ride.status, 48),
    reasonCode: safeString(ride.reasonCode, 64),
    serviceAreaId: safeString(ride.serviceAreaId, 80),
    vehicleType: safeString(ride.vehicleType, 16),
    estimatedFareCentavos: safeNumber(ride.estimatedFareCentavos),
    finalFareCentavos: safeNumber(ride.finalFareCentavos),
    paymentAmountCentavos: safeNumber(ride.paymentAmountCentavos),
    routeDistanceMeters: safeNumber(ride.routeDistanceMeters),
    routeDurationSeconds: safeNumber(ride.routeDurationSeconds),
    pricingConfigVersion: safeString(ride.pricingConfigVersion, 80),
    boundaryVersion: safeString(ride.boundaryVersion, 80),
    operationalPolygonVersion: safeString(ride.operationalPolygonVersion, 80),
    createdAtMs: safeNumber(ride.createdAtMs),
    searchExpiresAtMs: safeNumber(ride.searchExpiresAtMs),
    hasPickup: Boolean(ride.pickup),
    hasDestination: Boolean(ride.destination),
    pickupLabelPresent: Boolean(ride.pickup?.label),
    destinationLabelPresent: Boolean(ride.destination?.label),
    hasAcceptedDriver: Boolean(ride.acceptedDriverId || ride.acceptedDriverPublic),
    hasDriverPublicProfile: Boolean(ride.acceptedDriverPublic),
    hasPixPaymentPayload: Boolean(ride.paymentPixPayload),
    availableFields: Object.keys(ride).sort().slice(0, 100),
  });
}

export function sanitizeRideErrorForClientLog(error) {
  if (!error) return null;
  const details = error.details && typeof error.details === 'object' ? error.details : {};

  return compact({
    errorCode: safeString(details.code || error.code || error.name || 'UNKNOWN', 80),
    errorMessage: safeString(details.message || error.message || 'Erro desconhecido', 180),
    retryable: details.retryable === true || error.retryable === true,
  });
}

/**
 * Emits one stable JSON line. Search Metro with "[DriveLocal][RIDE_CLIENT]" or a
 * rideId/traceId to follow a complete client-side ride lifecycle.
 */
export function logRideClientEvent(eventName, fields = {}, level = 'info') {
  if (!CLIENT_RIDE_LOGS_ENABLED) return;

  const entry = compact({
    scope: 'ride_client',
    eventName: safeString(eventName, 96),
    at: new Date().toISOString(),
    action: safeString(fields.action, 64),
    step: safeString(fields.step, 64),
    rideId: safeString(fields.rideId, 128),
    status: safeString(fields.status, 48),
    resultStatus: safeString(fields.resultStatus, 48),
    vehicleType: safeString(fields.vehicleType, 16),
    originSource: safeString(fields.originSource, 16),
    hasPickupCoordinates:
      typeof fields.hasPickupCoordinates === 'boolean' ? fields.hasPickupCoordinates : null,
    hasDestinationCoordinates:
      typeof fields.hasDestinationCoordinates === 'boolean' ? fields.hasDestinationCoordinates : null,
    originTextLength: safeNumber(fields.originTextLength),
    destinationTextLength: safeNumber(fields.destinationTextLength),
    durationMs: safeNumber(fields.durationMs),
    ride: sanitizeRideForClientLog(fields.ride),
    error: sanitizeRideErrorForClientLog(fields.error),
  });

  const message = `[DriveLocal][RIDE_CLIENT] ${JSON.stringify(entry)}`;
  if (level === 'error') console.error(message);
  else if (level === 'warning') console.warn(message);
  else console.info(message);
}
