// In-memory fake Firestore for deterministic UNIT tests (no emulator, no cloud).
// Supports the minimal surface used by the domain helpers:
//   db.collection(name).doc(id?) -> { id, ref, set(data,{merge}), get(), delete() }
//   db.collection(name).where(field,'==',value).where(...).limit(n).get()
//        -> snapshot { size, docs:[{id,data(),ref}], forEach(cb) }
//   db.runTransaction(fn) -> fn({ get(ref), set(ref,data,{merge}), delete(ref) })
// Integration/concurrency behavior is covered separately against the emulator.

const crypto = require('crypto');

// Legacy ride-domain tests were written before the deployed service-area shape
// stored a serialized GeoJSON geometry. The fake Firestore normalizes only TEST
// cityPublicConfig documents so those tests exercise the same runtime contract
// as production without adding a fallback or mock polygon to production code.
const DEFAULT_TEST_SERVICE_AREA_BOUNDARY = Object.freeze({
  type: 'Polygon',
  coordinates: [[
    [-38.65, -4.25],
    [-38.35, -4.25],
    [-38.35, -3.95],
    [-38.65, -3.95],
    [-38.65, -4.25],
  ]],
});

function geometryBoundingBox(geometry) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function walk(value) {
    if (Array.isArray(value) && typeof value[0] === 'number') {
      const [lng, lat] = value;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
  }

  walk(geometry.coordinates);
  return [minLng, minLat, maxLng, maxLat];
}

function normalizeTestDocument(collectionName, docId, value) {
  const out = { ...(value || {}) };
  if (collectionName !== 'cityPublicConfig') return out;

  // An explicit boundaryGeoJson value (including null) is intentional and must
  // remain untouched so fail-closed tests can verify missing/corrupt config.
  if (Object.prototype.hasOwnProperty.call(out, 'boundaryGeoJson')) return out;

  const geometry = out.boundary && typeof out.boundary === 'object'
    ? out.boundary
    : DEFAULT_TEST_SERVICE_AREA_BOUNDARY;
  const serialized = JSON.stringify(geometry);

  out.serviceAreaId = out.serviceAreaId || docId;
  out.municipalityCode = out.municipalityCode || '2305233';
  out.boundaryVersion = out.boundaryVersion || 'test-boundary-v1';
  out.operationalPolygonVersion = out.operationalPolygonVersion || out.boundaryVersion;
  out.boundaryFormat = 'geojson-geometry-json-v1';
  out.boundaryGeoJson = serialized;
  out.boundaryChecksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(geometry.coordinates))
    .digest('hex');
  out.boundaryBoundingBox = geometryBoundingBox(geometry);

  // The real seeded Firestore document does not carry nested geometry arrays.
  delete out.boundary;
  return out;
}

function makeFakeFirestore() {
  const store = new Map();
  let autoSeq = 0;

  function docRef(collectionName, id) {
    const docId = id || `auto_${(autoSeq += 1)}`;
    const key = `${collectionName}/${docId}`;
    const ref = {
      id: docId,
      _key: key,
      async get() {
        const data = store.get(key);
        return { exists: data !== undefined, id: docId, data: () => data, ref };
      },
      async set(data, opts) {
        const prev = store.get(key);
        const next = opts && opts.merge && prev ? { ...prev, ...data } : { ...data };
        store.set(key, normalizeTestDocument(collectionName, docId, next));
      },
      async delete() {
        store.delete(key);
      },
    };
    return ref;
  }

  function makeQuery(collectionName, filters, limit) {
    return {
      where(field, op, value) {
        return makeQuery(collectionName, [...filters, { field, op, value }], limit);
      },
      limit(n) {
        return makeQuery(collectionName, filters, n);
      },
      async get() {
        const prefix = `${collectionName}/`;
        const docs = [];
        for (const [key, data] of store.entries()) {
          if (!key.startsWith(prefix)) continue;
          const ok = filters.every((f) => f.op === '==' && data && data[f.field] === f.value);
          if (!ok) continue;
          const id = key.slice(prefix.length);
          docs.push({ id, data: () => data, ref: docRef(collectionName, id) });
          if (limit != null && docs.length >= limit) break;
        }
        return {
          size: docs.length,
          docs,
          forEach: (cb) => docs.forEach(cb),
        };
      },
    };
  }

  return {
    _store: store,
    collection(collectionName) {
      return {
        doc: (id) => docRef(collectionName, id),
        where: (field, op, value) => makeQuery(collectionName, [{ field, op, value }], null),
        limit: (n) => makeQuery(collectionName, [], n),
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          const data = store.get(ref._key);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref, data, opts) {
          const prev = store.get(ref._key);
          const next = opts && opts.merge && prev ? { ...prev, ...data } : { ...data };
          const [collectionName, docId] = ref._key.split('/');
          store.set(ref._key, normalizeTestDocument(collectionName, docId, next));
        },
        delete(ref) {
          store.delete(ref._key);
        },
      };
      return fn(tx);
    },
  };
}

module.exports = { makeFakeFirestore, normalizeTestDocument, DEFAULT_TEST_SERVICE_AREA_BOUNDARY };
