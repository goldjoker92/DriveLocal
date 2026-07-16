#!/usr/bin/env node
// Import the OFFICIAL Horizonte-CE municipal boundary from IBGE, ONCE, into a
// small versioned GeoJSON artifact committed to the repo. This is a build-time
// tool — it is NEVER called at runtime and imports NO mobile/runtime dependency.
//
// Flow: official IBGE malhas API -> extract municipality 2305233 -> validate
// geometry (Polygon/MultiPolygon, closed rings, [lng,lat]) -> compute
// bbox/coordinateCount/checksum -> write the artifact.
//
// Source: IBGE malhas municipais v3 (GeoJSON). Municipality code 2305233 is the
// official IBGE code for Horizonte/CE. Coordinates are [longitude, latitude]
// (SIRGAS 2000, ~WGS84 for geofence purposes). Re-run to refresh; the output is
// deterministic except for generatedAt.
//
// Usage:
//   node scripts/geodata/import-horizonte-ibge.js           (fetch from IBGE)
//   node scripts/geodata/import-horizonte-ibge.js <file>    (use a local GeoJSON)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MUNICIPALITY_CODE = '2305233';
const SERVICE_AREA_ID = 'HORIZONTE_CE_BR';
const BOUNDARY_VERSION = '2024.1';
const IBGE_URL = `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${MUNICIPALITY_CODE}?formato=application/vnd.geo+json&qualidade=maxima`;
const OUT = path.join(__dirname, '..', '..', 'backend', 'firebase', 'config', 'service-areas', `${SERVICE_AREA_ID}.geojson`);

function fail(msg) {
  console.error(`[GEODATA] BLOCKED: ${msg}`);
  process.exit(1);
}

// Extract the first Polygon/MultiPolygon geometry from an IBGE response.
function extractGeometry(raw) {
  const feature = raw && raw.type === 'FeatureCollection' ? (raw.features || [])[0] : raw;
  const geom = (feature && feature.geometry) || raw.geometry || feature;
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
    fail(`unexpected geometry type: ${geom && geom.type}`);
  }
  return geom;
}

// Every linear ring must be closed (first coord === last coord).
function assertClosedRings(geom) {
  const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  for (const poly of polygons) {
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4) fail('ring has fewer than 4 positions');
      const a = ring[0];
      const b = ring[ring.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) fail('ring is not closed');
    }
  }
}

function computeBBox(geom) {
  let minLng = Infinity; let minLat = Infinity; let maxLng = -Infinity; let maxLat = -Infinity;
  let count = 0;
  const walk = (a) => {
    if (Array.isArray(a) && typeof a[0] === 'number') {
      const [lng, lat] = a;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) fail('non-finite coordinate');
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) fail('coordinate out of range');
      count += 1;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    } else if (Array.isArray(a)) {
      a.forEach(walk);
    }
  };
  walk(geom.coordinates);
  // Horizonte-CE sanity window (fail closed if the geometry is clearly wrong).
  if (minLng < -39.5 || maxLng > -37.5 || minLat < -5.5 || maxLat > -3.0) {
    fail(`bounding box outside Ceará window: [${minLng},${minLat},${maxLng},${maxLat}]`);
  }
  return { bbox: [minLng, minLat, maxLng, maxLat], count };
}

async function loadRaw(localFile) {
  if (localFile) return JSON.parse(fs.readFileSync(localFile, 'utf8'));
  const res = await fetch(IBGE_URL, { headers: { Accept: 'application/geo+json' } });
  if (!res.ok) fail(`IBGE responded ${res.status}`);
  return res.json();
}

async function main() {
  const localFile = process.argv[2];
  let raw;
  try {
    raw = await loadRaw(localFile);
  } catch (e) {
    // Do NOT fabricate geometry — stop only the geodata import and report the blocker.
    fail(`could not obtain official IBGE source (${e.message}). Geodata import stopped; no geometry generated.`);
    return;
  }
  const geom = extractGeometry(raw);
  assertClosedRings(geom);
  const { bbox, count } = computeBBox(geom);
  const checksum = crypto.createHash('sha256').update(JSON.stringify(geom.coordinates)).digest('hex');

  const artifact = {
    type: 'Feature',
    properties: {
      serviceAreaId: SERVICE_AREA_ID,
      municipalityCode: MUNICIPALITY_CODE,
      cityName: 'Horizonte',
      stateCode: 'CE',
      countryCode: 'BR',
      sourceOrganization: 'IBGE',
      sourceProduct: 'Malhas Municipais (API v3, malhas/municipios)',
      sourceEdition: 'v3-latest',
      sourceCRS: 'EPSG:4674 (SIRGAS 2000)',
      geometryType: geom.type,
      boundaryVersion: BOUNDARY_VERSION,
      coordinateCount: count,
      boundingBox: bbox,
      checksum,
      generatedAt: new Date().toISOString(),
    },
    geometry: geom,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`[GEODATA] wrote ${OUT}`);
  console.log(`[GEODATA] ${geom.type} coords=${count} bbox=${JSON.stringify(bbox)} checksum=${checksum.slice(0, 12)}…`);
}

main();
