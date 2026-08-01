// @ts-check
// Minimal Places API (New) adapter. The API key is injected by the callable and
// never crosses the server boundary. Provider payloads, queries, addresses and
// coordinates are never logged here.

const { AppError, ERROR_CODES } = require('../errors/appError');

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';
const DEFAULT_TIMEOUT_MS = 3500;

function providerError(cause, timeout = false) {
  return new AppError(timeout ? ERROR_CODES.PROVIDER_TIMEOUT : ERROR_CODES.PROVIDER_UNAVAILABLE, {
    internalMessage: timeout ? 'Places provider timed out' : 'Places provider request failed',
    cause,
  });
}

async function requestJson(url, options, { fetchImpl = global.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw providerError(new Error('fetch unavailable'));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response || response.ok !== true) {
      throw providerError(new Error(`Places provider HTTP ${response?.status || 'unknown'}`));
    }
    return await response.json();
  } catch (error) {
    if (AppError.isAppError(error)) throw error;
    throw providerError(error, error?.name === 'AbortError');
  } finally {
    clearTimeout(timeout);
  }
}

function validBoundingBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [minLng, minLat, maxLng, maxLat] = value.map(Number);
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

function autocompleteItems(payload, limit) {
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const items = [];
  for (const suggestion of suggestions) {
    const prediction = suggestion?.placePrediction;
    const placeId = typeof prediction?.placeId === 'string' ? prediction.placeId.trim() : '';
    const fullText = typeof prediction?.text?.text === 'string' ? prediction.text.text.trim() : '';
    const mainText = typeof prediction?.structuredFormat?.mainText?.text === 'string'
      ? prediction.structuredFormat.mainText.text.trim()
      : '';
    const secondaryText = typeof prediction?.structuredFormat?.secondaryText?.text === 'string'
      ? prediction.structuredFormat.secondaryText.text.trim()
      : '';
    if (!placeId || !(mainText || fullText)) continue;
    items.push({
      id: `google_places:${placeId}`.slice(0, 220),
      placeId: placeId.slice(0, 180),
      label: (mainText || fullText).slice(0, 160),
      secondaryLabel: secondaryText.slice(0, 180),
    });
    if (items.length >= limit) break;
  }
  return items;
}

function createGooglePlacesAdapter({ apiKey, fetchImpl = global.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) {
    throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
      internalMessage: 'PLACES_PROVIDER_API_KEY is not configured',
    });
  }

  return Object.freeze({
    async autocomplete({ query, boundingBox, sessionToken, limit = 5 }) {
      const box = validBoundingBox(boundingBox);
      if (!box) {
        throw new AppError(ERROR_CODES.CONFIGURATION_MISSING, {
          internalMessage: 'service-area bounding box unavailable for Places restriction',
        });
      }
      const body = {
        input: query,
        languageCode: 'pt-BR',
        regionCode: 'br',
        includedRegionCodes: ['br'],
        locationRestriction: {
          rectangle: {
            low: { latitude: box.minLat, longitude: box.minLng },
            high: { latitude: box.maxLat, longitude: box.maxLng },
          },
        },
      };
      if (sessionToken) body.sessionToken = sessionToken;

      const payload = await requestJson(
        AUTOCOMPLETE_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': cleanApiKey,
            'X-Goog-FieldMask': [
              'suggestions.placePrediction.placeId',
              'suggestions.placePrediction.text.text',
              'suggestions.placePrediction.structuredFormat.mainText.text',
              'suggestions.placePrediction.structuredFormat.secondaryText.text',
            ].join(','),
          },
          body: JSON.stringify(body),
        },
        { fetchImpl, timeoutMs }
      );
      return autocompleteItems(payload, Math.max(1, Math.min(5, Number(limit) || 5)));
    },

    async details({ placeId, sessionToken }) {
      const params = new URLSearchParams({ languageCode: 'pt-BR', regionCode: 'br' });
      if (sessionToken) params.set('sessionToken', sessionToken);
      const payload = await requestJson(
        `${DETAILS_URL}/${encodeURIComponent(placeId)}?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': cleanApiKey,
            'X-Goog-FieldMask': 'id,formattedAddress,location',
          },
        },
        { fetchImpl, timeoutMs }
      );
      const lat = Number(payload?.location?.latitude);
      const lng = Number(payload?.location?.longitude);
      const label = typeof payload?.formattedAddress === 'string' ? payload.formattedAddress.trim() : '';
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) return null;
      return { lat, lng, label: label.slice(0, 200) };
    },
  });
}

module.exports = {
  AUTOCOMPLETE_URL,
  DETAILS_URL,
  createGooglePlacesAdapter,
  validBoundingBox,
  autocompleteItems,
};
