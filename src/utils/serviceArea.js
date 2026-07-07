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

// ---------------------------------------------------------------------------
// Ride-level service-area validation (DriveLocal V1 pricing foundation).
// ---------------------------------------------------------------------------
// Business rule (see CLAUDE.md §G and the pricing spec):
//   - Reject when the PICKUP is outside Horizonte      -> OUT_OF_SERVICE_AREA
//   - Reject when the DESTINATION is outside Horizonte -> OUT_OF_SERVICE_AREA
//   - Accept when BOTH are inside Horizonte            -> ALLOWED (price by distance)
//
// IMPORTANT: distance is NOT a rejection reason. A valid local ride inside
// Horizonte can be > 10 km — never return OUT_OF_RANGE for it. Distance only
// selects the price tier in utils/ridePricing.js.
//
// TODO(service-area): this reuses the SIMPLE city/state check (no polygon yet).
// When the official Horizonte boundary (polygon/multipolygon + border buffer)
// is available, plug the GPS point-in-polygon test in HERE only — the ride flow
// calls this function and must not need to change. See mock/serviceAreas.js and
// seed/serviceAreas/HORIZONTE_CE_BR.json for where the boundary config will live.
//
// `pickup` and `destination` accept { city, state, source } (source 'gps' or
// 'manual'), matching checkOriginServiceArea. When a point cannot be determined
// we ask for manual confirmation instead of hard-blocking (locked 3A behavior).
export function checkRideServiceArea({ pickup, destination } = {}) {
  const pickupCheck = checkOriginServiceArea(pickup || {});
  const destinationCheck = checkOriginServiceArea(destination || {});

  if (pickupCheck.status === 'blocked') {
    console.log('[PricingV1] pickup OUT_OF_SERVICE_AREA');
    return { status: 'OUT_OF_SERVICE_AREA', at: 'pickup', pickupCheck, destinationCheck };
  }
  if (destinationCheck.status === 'blocked') {
    console.log('[PricingV1] destination OUT_OF_SERVICE_AREA');
    return { status: 'OUT_OF_SERVICE_AREA', at: 'destination', pickupCheck, destinationCheck };
  }
  if (pickupCheck.status === 'undetermined' || destinationCheck.status === 'undetermined') {
    return { status: 'NEEDS_MANUAL_CONFIRMATION', pickupCheck, destinationCheck };
  }

  return { status: 'ALLOWED', pickupCheck, destinationCheck };
}
