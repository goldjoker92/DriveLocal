// External navigation helpers (Step 1 frontend only).
//
// DriveLocal MVP 0.1 does NOT do in-app navigation:
//   - no in-app turn-by-turn
//   - no live driver tracking / moving marker
//   - no background GPS
// We ONLY open external navigation apps (Google Maps / Waze) with the correct
// coordinates already filled in, so the driver never copies/pastes an address.
//
// Two location concepts per ride:
//   pickup      -> go fetch the passenger      (ride.pickup.lat / .lng)
//   destination -> drive passenger to the end  (ride.destination.lat / .lng)

import { Linking } from 'react-native';

// Google Maps: full route from an origin point to a destination point.
// origin/destination are { lat, lng }.
export function openGoogleMapsRoute({ origin, destination }) {
  const from = `${origin.lat},${origin.lng}`;
  const to = `${destination.lat},${destination.lng}`;
  const url =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${from}&destination=${to}&travelmode=driving`;
  // TODO(production): handle errors / app-not-installed gracefully.
  return Linking.openURL(url);
}

// Google Maps: navigate to a single point (current location -> point).
// `label` is accepted for future UI use; the deep link uses coordinates only
// so the destination is always exact.
export function openGoogleMapsToPoint({ lat, lng, label }) {
  const url =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${lat},${lng}&travelmode=driving`;
  return Linking.openURL(url);
}

// Waze: navigate to a single point. Waze always routes from current location,
// so there is only a destination point.
export function openWazeToPoint({ lat, lng }) {
  const url = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  // TODO(production): if Waze is not installed, fall back gracefully
  // (e.g. Linking.canOpenURL first, then offer Google Maps instead).
  return Linking.openURL(url);
}

// Waze: alias kept for naming symmetry with the Google Maps helpers.
export function openWazeRoute({ lat, lng }) {
  return openWazeToPoint({ lat, lng });
}
