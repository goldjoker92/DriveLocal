// Location service (Iteration 3A). Minimal foreground-only pattern for the
// passenger ride-request origin. NO MapView, NO live tracking, NO background
// GPS (see constants/mapRules.js). We only:
//   1. request FOREGROUND permission
//   2. read the current position once
//   3. try a minimal reverse geocode to pre-fill a readable address + city/state
// The passenger must still confirm/correct the address before requesting a ride.

import * as Location from 'expo-location';

// Builds a short readable address from a reverse-geocode result.
// Prefers "street, number" then falls back to name, and appends the district.
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

// Requests permission + current location, then a best-effort reverse geocode.
// Never throws: always resolves to a status object the UI can branch on.
//   { status: 'denied' }  -> permission refused (UI falls back to manual)
//   { status: 'error' }   -> location lookup failed (UI falls back to manual)
//   { status: 'ok', lat, lng, addressText, city, state }
//       addressText / city / state may be '' when geocoding is unavailable.
export async function getCurrentLocationWithAddress() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    console.log('[LOCATION] permission status=', status);
    if (status !== 'granted') {
      return { status: 'denied' };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    console.log('[LOCATION] position lat=', lat, 'lng=', lng);

    let addressText = '';
    let city = '';
    let state = '';
    try {
      const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const place = places && places[0];
      if (place) {
        addressText = buildAddressText(place);
        city = place.city || place.subregion || '';
        state = place.region || '';
        console.log('[LOCATION] reverse geocode city=', city, 'state=', state);
      }
    } catch (geoError) {
      // Reverse geocode can fail (no network / no provider). We still return the
      // coordinates so the passenger can type the address manually.
      console.log('[LOCATION] reverse geocode failed:', geoError.message);
    }

    return { status: 'ok', lat, lng, addressText, city, state };
  } catch (e) {
    console.log('[LOCATION] getCurrentLocation error:', e.message);
    return { status: 'error' };
  }
}

// Resolves a full typed address to real coordinates via expo-location's native
// geocoder (a REAL provider — not typeahead autocomplete, not invented). Returns
// a status object the UI branches on; never fabricates coordinates.
//   { status: 'too_short' } | { status: 'not_found' } | { status: 'error' }
//   { status: 'ok', lat, lng, addressText }
export async function resolveAddressToCoords(text) {
  const query = (text || '').trim();
  if (query.length < 3) return { status: 'too_short' };
  try {
    const results = await Location.geocodeAsync(query);
    const first = results && results[0];
    if (!first || typeof first.latitude !== 'number' || typeof first.longitude !== 'number') {
      return { status: 'not_found' };
    }
    return { status: 'ok', lat: first.latitude, lng: first.longitude, addressText: query };
  } catch (e) {
    console.log('[LOCATION] geocode failed:', e.message);
    return { status: 'error' };
  }
}
