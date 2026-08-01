// Local-first address autocomplete. City Pack results are available without a
// network call. Google Places is reached only through authenticated Cloud
// Functions when the local pack has no strong answer; the API key never reaches
// the mobile application.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';
import { ACTIVE_SERVICE_AREA_ID } from '../constants/serviceAreaIds';
import { getCityPlacePack } from '../constants/cityPlacePacks';
import {
  MAX_PLACE_SUGGESTIONS,
  hasStrongLocalPlaceMatch,
  normalizePlaceSearchText,
  searchCityPlacePack,
} from '../utils/placeSearch';

const searchPlaceSuggestionsSecure = httpsCallable(functions, 'searchPlaceSuggestionsSecure');
const resolvePlaceSuggestionSecure = httpsCallable(functions, 'resolvePlaceSuggestionSecure');
const USAGE_KEY_PREFIX = '@drivelocal/city-place-usage/v1/';

function safeItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .slice(0, MAX_PLACE_SUGGESTIONS)
    .map((item) => ({
      id: item.id.slice(0, 180),
      placeId: typeof item.placeId === 'string' ? item.placeId.slice(0, 180) : null,
      source: 'google_places',
      label: String(item.label || '').trim().slice(0, 160),
      secondaryLabel: String(item.secondaryLabel || '').trim().slice(0, 180),
      queryText: String(item.label || '').trim().slice(0, 200),
      hasCoordinates: false,
    }))
    .filter((item) => item.label && item.placeId);
}

async function loadUsage(serviceAreaId) {
  try {
    const raw = await AsyncStorage.getItem(`${USAGE_KEY_PREFIX}${serviceAreaId}`);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

export async function recordLocalPlaceSelection(serviceAreaId, localId) {
  if (!serviceAreaId || !localId) return;
  const key = `${USAGE_KEY_PREFIX}${serviceAreaId}`;
  try {
    const usage = await loadUsage(serviceAreaId);
    usage[localId] = Math.min(999, Math.max(0, Number(usage[localId]) || 0) + 1);
    const entries = Object.entries(usage)
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .slice(0, 80);
    await AsyncStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
  } catch (_error) {
    // Ranking personalization is optional and must never block a ride request.
  }
}

export function createPlacesSessionToken() {
  return `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export async function searchAddressSuggestions({
  query,
  serviceAreaId = ACTIVE_SERVICE_AREA_ID,
  sessionToken,
  allowExternal = true,
} = {}) {
  const cleanQuery = String(query || '').trim().slice(0, 120);
  if (normalizePlaceSearchText(cleanQuery).length < 2) {
    return { items: [], externalCalled: false, providerAvailable: true };
  }

  const pack = getCityPlacePack(serviceAreaId);
  const usage = await loadUsage(serviceAreaId);
  const localItems = searchCityPlacePack(pack, cleanQuery, usage, MAX_PLACE_SUGGESTIONS);

  if (
    !allowExternal
    || normalizePlaceSearchText(cleanQuery).length < 3
    || hasStrongLocalPlaceMatch(localItems)
  ) {
    return { items: localItems, externalCalled: false, providerAvailable: true };
  }

  try {
    const response = await searchPlaceSuggestionsSecure({
      query: cleanQuery,
      serviceAreaId,
      sessionToken: String(sessionToken || '').slice(0, 120),
      limit: MAX_PLACE_SUGGESTIONS,
    });
    const externalItems = safeItems(response?.data?.items);
    const seen = new Set();
    const combined = [];
    for (const item of [...localItems, ...externalItems]) {
      const key = normalizePlaceSearchText(item.label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
      if (combined.length >= MAX_PLACE_SUGGESTIONS) break;
    }
    return { items: combined, externalCalled: true, providerAvailable: true };
  } catch (_error) {
    return { items: localItems, externalCalled: true, providerAvailable: false };
  }
}

export async function resolveAddressSuggestion({
  suggestion,
  serviceAreaId = ACTIVE_SERVICE_AREA_ID,
  sessionToken,
} = {}) {
  if (!suggestion || typeof suggestion !== 'object') {
    return { status: 'invalid' };
  }

  if (suggestion.source === 'city_pack') {
    await recordLocalPlaceSelection(serviceAreaId, suggestion.localId);
    return {
      status: 'ok',
      source: 'city_pack',
      label: String(suggestion.queryText || suggestion.label || '').trim().slice(0, 200),
      lat: null,
      lng: null,
      placeId: null,
    };
  }

  if (suggestion.source !== 'google_places' || !suggestion.placeId) {
    return { status: 'invalid' };
  }

  try {
    const response = await resolvePlaceSuggestionSecure({
      placeId: String(suggestion.placeId).slice(0, 180),
      serviceAreaId,
      sessionToken: String(sessionToken || '').slice(0, 120),
    });
    const data = response?.data && typeof response.data === 'object' ? response.data : {};
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (data.status !== 'ok' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { status: 'not_found' };
    }
    return {
      status: 'ok',
      source: 'google_places',
      label: String(data.label || suggestion.label || '').trim().slice(0, 200),
      lat,
      lng,
      placeId: String(suggestion.placeId).slice(0, 180),
    };
  } catch (_error) {
    return { status: 'error' };
  }
}
