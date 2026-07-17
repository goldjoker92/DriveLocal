// In-memory fake Firestore for deterministic UNIT tests (no emulator, no cloud).
// Supports the minimal surface used by the domain helpers:
//   db.collection(name).doc(id?) -> { id, ref, set(data,{merge}), get(), delete() }
//   db.collection(name).where(field,'==',value).where(...).limit(n).get()
//        -> snapshot { size, docs:[{id,data(),ref}], forEach(cb) }
//   db.runTransaction(fn) -> fn({ get(ref), set(ref,data,{merge}), delete(ref) })
// Integration/concurrency behavior is covered separately against the emulator.

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
        store.set(key, opts && opts.merge && prev ? { ...prev, ...data } : { ...data });
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
          store.set(ref._key, opts && opts.merge && prev ? { ...prev, ...data } : { ...data });
        },
        delete(ref) {
          store.delete(ref._key);
        },
      };
      return fn(tx);
    },
  };
}

module.exports = { makeFakeFirestore };
