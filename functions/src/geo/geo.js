// @ts-check
// Geospatial helpers. Two distinct concerns kept separate on purpose:
//   - pointInServiceArea(): authoritative geofence test against the configured
//     polygon/multipolygon (used to accept/refuse a ride);
//   - haversineMeters(): great-circle distance used ONLY for candidate proximity
//     (search radius + distanceToPickup preview). It is NEVER used to compute a
//     fare — the fare distance always comes from the routing provider.

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (Number(deg) * Math.PI) / 180;
}

// Great-circle distance in meters. Proximity only — not a routing distance.
function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Ray-casting point-in-polygon. `ring` is [[lng,lat], ...] (GeoJSON order).
function pointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Point inside a single polygon (outer ring minus holes).
function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h += 1) {
    if (pointInRing(point, polygon[h])) return false; // inside a hole
  }
  return true;
}

/**
 * True when `point` ({lat,lng}) is inside a GeoJSON Polygon or MultiPolygon
 * `boundary`. Accepts { type:'Polygon', coordinates } or
 * { type:'MultiPolygon', coordinates } or a bare coordinates array (treated as a
 * Polygon). Returns false for any unrecognized / empty boundary (fail closed).
 * @param {{lat:number,lng:number}} point
 * @param {object} boundary GeoJSON geometry
 */
function pointInServiceArea(point, boundary) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  if (!boundary) return false;
  const type = boundary.type;
  const coords = boundary.coordinates || (Array.isArray(boundary) ? boundary : null);
  if (!coords) return false;
  if (type === 'MultiPolygon') {
    return coords.some((poly) => pointInPolygon(point, poly));
  }
  // Polygon (default).
  return pointInPolygon(point, coords);
}

module.exports = { haversineMeters, pointInServiceArea, pointInPolygon };
