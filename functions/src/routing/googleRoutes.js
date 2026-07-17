// @ts-check
// Thin isolated Google Routes API adapter (Compute Routes). Fails closed on any
// provider error and never falls back to straight-line estimates.

const { AppError, ERROR_CODES } = require('../errors/appError');

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 10 * 1000;
const TRAVEL_MODE = Object.freeze({ car: 'DRIVE', moto: 'TWO_WHEELER' });

function waypoint(coord) {
  return { location: { latLng: { latitude: Number(coord.lat), longitude: Number(coord.lng) } } };
}

function parseDurationSeconds(value) {
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string') {
    const n = Number(value.replace(/s$/, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

function createGoogleRoutesAdapter(cfg = {}) {
  const apiKey = cfg.apiKey;
  const timeoutMs = cfg.timeoutMs || TIMEOUT_MS;
  const fetchImpl = cfg.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!apiKey) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, { internalMessage: 'routing api key missing' });
  }
  if (!fetchImpl) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, { internalMessage: 'no fetch implementation for routing' });
  }

  return {
    async computeRoute(p) {
      const travelMode = TRAVEL_MODE[p.vehicleType];
      if (!travelMode) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, { internalMessage: `unsupported vehicleType for routing: ${p.vehicleType}` });
      }
      const body = {
        origin: waypoint(p.origin),
        destination: waypoint(p.destination),
        travelMode,
        // Uses traffic conditions at request time (Google defaults departureTime
        // to now). Supported for DRIVE and TWO_WHEELER.
        routingPreference: 'TRAFFIC_AWARE',
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(COMPUTE_ROUTES_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
          throw new AppError(ERROR_CODES.PROVIDER_TIMEOUT, { internalMessage: 'routing request timed out', cause: err });
        }
        throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, { internalMessage: 'routing request failed', cause: err });
      }
      clearTimeout(timer);

      if (res.status === 401 || res.status === 403) {
        throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, { internalMessage: `routing auth rejected (status ${res.status})` });
      }
      if (res.status >= 400) {
        throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, { internalMessage: `routing provider error (status ${res.status})` });
      }

      let json = {};
      try {
        const text = await res.text();
        json = text ? JSON.parse(text) : {};
      } catch (_e) {
        throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, { internalMessage: 'routing response not parseable' });
      }

      const route = Array.isArray(json.routes) ? json.routes[0] : null;
      const distanceMeters = route ? Number(route.distanceMeters) : NaN;
      const durationSeconds = route ? parseDurationSeconds(route.duration) : null;
      if (!route || !Number.isFinite(distanceMeters) || distanceMeters <= 0 || durationSeconds == null || durationSeconds <= 0) {
        throw new AppError(ERROR_CODES.PROVIDER_UNAVAILABLE, { internalMessage: 'routing returned no usable route' });
      }
      return { distanceMeters, durationSeconds };
    },
  };
}

module.exports = { createGoogleRoutesAdapter, TRAVEL_MODE, COMPUTE_ROUTES_URL };
