// Service-area helpers (Iteration 3A).
// SIMPLE city/state block only — NOT a polygon geofence and NOT local zones
// (both deferred). DriveLocal V1 is intra-city Horizonte-CE. The active area
// comes from the serviceArea config, so no city is hardcoded in business logic.

import { mockServiceAreas } from '../mock/serviceAreas';
import { ACTIVE_SERVICE_AREA_ID } from '../constants/serviceAreaIds';

// Accent/case-insensitive normalize for text comparison ("Ceara" match "Ceará").
// ̀-ͯ is the Unicode combining-diacritical range stripped after NFD.
function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// The serviceArea DriveLocal is currently operating in.
export function getActiveServiceArea() {
  return mockServiceAreas.find((a) => a.id === ACTIVE_SERVICE_AREA_ID) || null;
}

// Decides whether an origin is inside the active service area.
//   source 'manual' -> we ASSUME the active area's city/state (never blocked in 3A).
//   source 'gps'    -> compare the reverse-geocoded city/state:
//       city + state present and match       -> 'allowed'
//       city + state present and DON'T match  -> 'blocked'
//       city or state missing (undetermined)  -> 'undetermined' (ask manual confirm)
// Returns { status, expectedCity, expectedState }.
export function checkOriginServiceArea({ city, state, source } = {}) {
  const area = getActiveServiceArea();
  const expectedCity = (area && area.city) || 'Horizonte';
  const expectedState = (area && area.state) || 'CE';
  const stateNames = (area && area.stateNames) || [expectedState];

  // Manual entry assumes the active city/state per locked 3A rules.
  if (source !== 'gps') {
    return { status: 'allowed', expectedCity, expectedState };
  }

  const hasCity = city !== undefined && city !== null && String(city).trim() !== '';
  const hasState = state !== undefined && state !== null && String(state).trim() !== '';

  // Cannot determine -> do NOT hard-block by coordinates; ask manual confirm.
  if (!hasCity || !hasState) {
    return { status: 'undetermined', expectedCity, expectedState };
  }

  const cityOk = normalize(city) === normalize(expectedCity);
  const stateOk = stateNames.some((name) => normalize(name) === normalize(state));

  return {
    status: cityOk && stateOk ? 'allowed' : 'blocked',
    expectedCity,
    expectedState,
  };
}
