// BLOCK 13 — Horizonte boundary artifact, local geofence, service-area identity
// and seed config. No live IBGE download; the committed artifact is the source.
// Runtime geofence never imports test doubles.

const { pointInServiceArea } = require('../geo/geo');
const { loadBoundaryArtifact, validateBoundaryArtifact } = require('../geo/boundaryArtifact');
const { getServiceAreaIdentity, SERVICE_AREAS, DEFAULT_SERVICE_AREA_ID } = require('../config/serviceAreaIdentity');
const { buildServiceAreaConfig } = require('../config/serviceAreaConfig');

const ID = 'HORIZONTE_CE_BR';
const artifact = loadBoundaryArtifact(ID);
const report = validateBoundaryArtifact(artifact);
const geom = artifact.geometry;
const bbox = artifact.properties.boundingBox;
const interior = { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 };

describe('Horizonte boundary artifact', () => {
  it('loads and is a valid Polygon/MultiPolygon with closed rings', () => {
    expect(['Polygon', 'MultiPolygon']).toContain(geom.type);
    expect(report.coordinateCount).toBeGreaterThan(3);
  });
  it('carries checksum and version metadata that match the geometry', () => {
    expect(artifact.properties.checksum).toBe(report.checksum);
    expect(artifact.properties.boundaryVersion).toBe(getServiceAreaIdentity(ID).boundaryVersion);
    expect(artifact.properties.municipalityCode).toBe('2305233');
  });
  it('uses [longitude, latitude] order and a bbox matching the geometry', () => {
    // Horizonte-CE: lng ~ -38.5, lat ~ -4.1.
    expect(bbox[0]).toBeGreaterThan(-39.5); expect(bbox[2]).toBeLessThan(-37.5);
    expect(bbox[1]).toBeGreaterThan(-5.5); expect(bbox[3]).toBeLessThan(-3.0);
    expect(report.bbox).toEqual(bbox);
  });
  it('rejects a geometry whose checksum no longer matches (tamper detection)', () => {
    const tampered = { ...artifact, geometry: { ...geom, coordinates: [] } };
    expect(() => validateBoundaryArtifact(tampered)).toThrow();
  });
});

describe('local geofence', () => {
  it('accepts an interior Horizonte point', () => {
    expect(pointInServiceArea(interior, geom)).toBe(true);
  });
  it('rejects Pacajus and Fortaleza points', () => {
    expect(pointInServiceArea({ lat: -4.1727, lng: -38.4601 }, geom)).toBe(false); // Pacajus
    expect(pointInServiceArea({ lat: -3.7319, lng: -38.5267 }, geom)).toBe(false); // Fortaleza
  });
  it('rejects malformed / out-of-range coordinates (fail closed)', () => {
    expect(pointInServiceArea({ lat: NaN, lng: -38.5 }, geom)).toBe(false);
    expect(pointInServiceArea({ lat: Infinity, lng: -38.5 }, geom)).toBe(false);
    expect(pointInServiceArea({ lat: -4.1, lng: null }, geom)).toBe(false);
    expect(pointInServiceArea(null, geom)).toBe(false);
    expect(pointInServiceArea(interior, null)).toBe(false);
  });
  it('is deterministic (same input -> same result)', () => {
    expect(pointInServiceArea(interior, geom)).toBe(pointInServiceArea(interior, geom));
  });
});

describe('service-area identity (multi-city, data-driven)', () => {
  it('resolves Horizonte and returns null for an unknown id (no literal branching)', () => {
    expect(getServiceAreaIdentity(ID).municipalityCode).toBe('2305233');
    expect(getServiceAreaIdentity('PACAJUS_CE_BR')).toBeNull();
    expect(DEFAULT_SERVICE_AREA_ID).toBe(ID);
  });
  it('another city can be added purely by configuration (same shape)', () => {
    const fake = { ...SERVICE_AREAS[ID], serviceAreaId: 'X_CE_BR', municipalityCode: '9999999', cityName: 'X' };
    const cfg = buildServiceAreaConfig(fake, artifact, report, {});
    expect(cfg.serviceAreaId).toBe('X_CE_BR');
    expect(cfg.enabled).toBe(true);
  });
});

describe('seed config builder (idempotent, preserves runtime fields)', () => {
  const identity = getServiceAreaIdentity(ID);
  it('produces the same document on replay (deterministic)', () => {
    const a = buildServiceAreaConfig(identity, artifact, report, {});
    const b = buildServiceAreaConfig(identity, artifact, report, {});
    expect(a).toEqual(b);
  });
  it('carries over existing allowedVehicleTypes and never emits counters/pricing', () => {
    const cfg = buildServiceAreaConfig(identity, artifact, report, { allowedVehicleTypes: ['moto'] });
    expect(cfg.allowedVehicleTypes).toEqual(['moto']);
    expect(cfg.approvedCount).toBeUndefined();
    expect(cfg.pricing).toBeUndefined();
  });
});

// Firestore rejects an array whose element is itself an array. GeoJSON
// coordinates are nested arrays, so the config must serialize the geometry
// instead of storing it raw. These tests lock that contract in.
describe('seed config builder (Firestore-safe boundary serialization)', () => {
  const identity = getServiceAreaIdentity(ID);
  // True when no array in `value` directly contains another array (the exact
  // shape Firestore rejects). Objects/maps may still hold arrays.
  function noNestedArrays(value) {
    if (Array.isArray(value)) {
      return value.every((el) => !Array.isArray(el) && noNestedArrays(el));
    }
    if (value && typeof value === 'object') {
      return Object.values(value).every(noNestedArrays);
    }
    return true;
  }

  it('emits no raw `boundary` nested-array field', () => {
    const cfg = buildServiceAreaConfig(identity, artifact, report, {});
    expect(cfg.boundary).toBeUndefined();
  });
  it('serializes the geometry as a valid JSON string with a versioned format tag', () => {
    const cfg = buildServiceAreaConfig(identity, artifact, report, {});
    expect(cfg.boundaryFormat).toBe('geojson-geometry-json-v1');
    expect(typeof cfg.boundaryGeoJson).toBe('string');
    expect(cfg.boundaryGeoJson.length).toBeGreaterThan(0);
    expect(() => JSON.parse(cfg.boundaryGeoJson)).not.toThrow();
  });
  it('round-trips boundaryGeoJson back to the original geometry', () => {
    const cfg = buildServiceAreaConfig(identity, artifact, report, {});
    expect(JSON.parse(cfg.boundaryGeoJson)).toEqual(artifact.geometry);
    expect(JSON.parse(cfg.boundaryGeoJson).type).toBe(geom.type);
  });
  it('keeps checksum, bbox and version fields unchanged', () => {
    const cfg = buildServiceAreaConfig(identity, artifact, report, {});
    expect(cfg.boundaryChecksum).toBe(report.checksum);
    expect(cfg.boundaryBoundingBox).toEqual(report.bbox);
    expect(cfg.boundaryVersion).toBe(identity.boundaryVersion);
    expect(cfg.operationalPolygonVersion).toBe(identity.operationalPolygonVersion);
    expect(cfg.coverageMode).toBe(identity.coverageMode);
  });
  it('contains no unsupported nested Firestore arrays anywhere in the document', () => {
    const cfg = buildServiceAreaConfig(identity, artifact, report, { allowedVehicleTypes: ['moto', 'car'] });
    expect(noNestedArrays(cfg)).toBe(true);
    // allowedVehicleTypes (flat string array) and boundaryBoundingBox (flat
    // number array) are allowed and must survive.
    expect(cfg.allowedVehicleTypes).toEqual(['moto', 'car']);
    expect(Array.isArray(cfg.boundaryBoundingBox)).toBe(true);
  });
});
