// @ts-check
// Loads and validates the committed IBGE boundary artifact. Used by the seed
// tool and tests — NOT during ride requests (the runtime geofence reads the
// operational polygon from the seeded Firestore config; IBGE is never called at
// runtime). Coordinates are GeoJSON [longitude, latitude].

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Repo path of the committed artifacts (outside functions/, build/seed-time only).
const ARTIFACT_DIR = path.join(__dirname, '..', '..', '..', 'backend', 'firebase', 'config', 'service-areas');

/** Loads the raw GeoJSON Feature artifact for a serviceAreaId. Throws if absent. */
function loadBoundaryArtifact(serviceAreaId) {
  const file = path.join(ARTIFACT_DIR, `${serviceAreaId}.geojson`);
  if (!fs.existsSync(file)) {
    throw new Error(`boundary artifact missing for ${serviceAreaId}: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function allRings(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polys.flat();
}

/**
 * Validates artifact shape/topology and recomputes bbox + checksum, returning a
 * report. Fails closed: any structural problem throws. Keeps validation logic in
 * one place so the seed and tests agree.
 */
function validateBoundaryArtifact(artifact) {
  const p = (artifact && artifact.properties) || {};
  const geom = artifact && artifact.geometry;
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
    throw new Error(`invalid geometry type: ${geom && geom.type}`);
  }
  for (const ring of allRings(geom)) {
    if (!Array.isArray(ring) || ring.length < 4) throw new Error('ring has fewer than 4 positions');
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) throw new Error('ring not closed');
  }
  let minLng = Infinity; let minLat = Infinity; let maxLng = -Infinity; let maxLat = -Infinity; let count = 0;
  const walk = (a) => {
    if (Array.isArray(a) && typeof a[0] === 'number') {
      const [lng, lat] = a;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('non-finite coordinate');
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) throw new Error('coordinate out of range');
      count += 1;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    } else if (Array.isArray(a)) { a.forEach(walk); }
  };
  walk(geom.coordinates);
  const bbox = [minLng, minLat, maxLng, maxLat];
  const checksum = crypto.createHash('sha256').update(JSON.stringify(geom.coordinates)).digest('hex');
  for (const key of ['serviceAreaId', 'municipalityCode', 'boundaryVersion', 'checksum', 'boundingBox']) {
    if (p[key] == null) throw new Error(`artifact missing metadata: ${key}`);
  }
  if (p.checksum !== checksum) throw new Error('checksum mismatch (geometry changed without re-import)');
  return { geometryType: geom.type, coordinateCount: count, bbox, checksum };
}

module.exports = { loadBoundaryArtifact, validateBoundaryArtifact, ARTIFACT_DIR };
