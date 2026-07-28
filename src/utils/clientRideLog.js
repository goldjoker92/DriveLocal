import { APP_ENVIRONMENT } from '../config/runtimeEnvironment';

// Structured client-side ride traces for development builds.
//
// These logs are intentionally rich enough to debug the whole passenger flow
// (request -> quote -> dispatch -> assignment -> payment), while still excluding
// exact coordinates, street labels, Pix payloads, phone numbers, tokens,
// counterparty identifiers and exact platform commission amounts. Production
// builds do not emit these traces.
const DEV_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__ === true;
const CLIENT_RIDE_LOGS_ENABLED = APP_ENVIRONMENT === 'development' || DEV_RUNTIME;
const SAFE_COMMISSION_DISPLAY_BPS = new Set([0, 1200, 1500]);
const OPERATIONAL_PHASES = new Set([
  'requested',
  'started',
  'succeeded',
  'failed',
  'restored',
  'duplicate_ignored',
]);

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

function safeCommissionDisplayBps(value) {
  const bps = safeNumber(value);
  return SAFE_COMMISSION_DISPLAY_BPS.has(bps) ? bps : null;
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined)
  );
}

export function deriveOperationalPhase(eventName, explicitPhase = null) {
  const explicit = safeString(explicitPhase, 32)?.toLowerCase();
  if (explicit && OPERATIONAL_PHASES.has(explicit)) return explicit;

  const event = safeString(eventName, 160)?.toLowerCase() || '';
  if (event.includes('duplicate_ignored')) return 'duplicate_ignored';
  if (/(restored|recovered|replayed|resume)/.test(event)) return 'restored';
  if (/(requested|request_started)/.test(event)) return 'requested';
  if (/(started|starting|attempted)/.test(event)) return 'started';
  if (/(failed|failure|rejected|denied|error|expired)/.test(event)) return 'failed';
  if (/(succeeded|success|sent|completed|confirmed|captured|created|accepted|arrived|won|cancelled)/.test(event)) {
    return 'succeeded';
  }
  return null;
}

/**
 * Returns a privacy-safe but operationally complete ride snapshot for Metro logs.
 * Presence booleans make missing projections visible without listing arbitrary
 * source keys, which could itself reveal private schema details.
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
    commissionDisplayBps: safeCommissionDisplayBps(ride.commissionDisplayBps),
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
  });
}

export function sanitizeRideErrorForClientLog(error) {
  if (!error) return null;
  const details = error.details && typeof error.details === 'object' ? error.details : {};

  // Error messages are deliberately excluded. They can contain an address, a name,
  // a provider payload or user-entered text even when the surrounding key is safe.
  return compact({
    errorCode: safeString(details.code || error.code || error.name || 'UNKNOWN', 80),
    retryable: details.retryable === true || error.retryable === true,
  });
}

/**
 * Emits one stable JSON line. Search Metro with "[DriveLocal][RIDE_CLIENT]" or a
 * rideId/traceId to follow a complete client-side ride lifecycle.
 *
 * Operational failures use console.warn instead of console.error. React Native's
 * development console turns console.error into a red overlay with a stack pointing
 * at this logger, which hides the useful JSON and makes the logger look like the
 * cause. Severity remains explicit inside the structured entry.
 */
export function logRideClientEvent(eventName, fields = {}, level = 'info') {
  if (!CLIENT_RIDE_LOGS_ENABLED) return;

  const severity = level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info';
  const entry = compact({
    scope: 'ride_client',
    severity,
    eventName: safeString(eventName, 96),
    phase: deriveOperationalPhase(eventName, fields.phase),
    at: new Date().toISOString(),
    action: safeString(fields.action, 64),
    route: safeString(fields.route, 96),
    step: safeString(fields.step, 64),
    provider: safeString(fields.provider, 32),
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
  if (severity === 'info') console.info(message);
  else console.warn(message);
}
