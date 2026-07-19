// Foreground-only passenger location and native geocoding service.
// Exact coordinates and addresses are never logged.

import * as Location from 'expo-location';

function buildAddressText(place) {
  if (!place) return '';
  const parts = [];
  if (place.street) {
    parts.push(place.streetNumber ? `${place.street}, ${place.streetNumber}` : place.street);
  } else if (place.name) {
    parts.push(place.name);
  }
  if (place.district) parts.push(place.district);
  else if (place.subregion) parts.push(place.subregion);
  return parts.filter(Boolean).join(', ');
}

// Android requires foreground location permission before native geocoding can
// run. Reuse an existing grant and ask only when the OS still allows a prompt.
async function ensureForegroundPermission() {
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== 'granted' && permission.canAskAgain) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  return permission.status === 'granted';
}

export async function getCurrentLocationWithAddress() {
  try {
    const granted = await ensureForegroundPermission();
    if (!granted) return { status: 'denied' };

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    let addressText = '';
    let city = '';
    let state = '';
    try {
      const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const place = places?.[0];
      if (place) {
        addressText = buildAddressText(place);
        city = place.city || place.subregion || '';
        state = place.region || '';
      }
    } catch (_geoError) {
      // Coordinates remain usable when reverse geocoding is unavailable.
    }

    return { status: 'ok', lat, lng, addressText, city, state };
  } catch (_e) {
    return { status: 'error' };
  }
}

export async function resolveAddressToCoords(text) {
  const query = (text || '').trim();
  if (query.length < 3) return { status: 'too_short' };

  try {
    const granted = await ensureForegroundPermission();
    if (!granted) return { status: 'denied' };

    const results = await Location.geocodeAsync(query);
    const first = results?.[0];
    if (!first || typeof first.latitude !== 'number' || typeof first.longitude !== 'number') {
      return { status: 'not_found' };
    }
    return { status: 'ok', lat: first.latitude, lng: first.longitude, addressText: query };
  } catch (_e) {
    return { status: 'error' };
  }
}
