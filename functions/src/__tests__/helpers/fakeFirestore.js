// In-memory fake Firestore for deterministic UNIT tests (no emulator, no cloud).
// Supports the minimal surface used by idempotency/audit helpers:
//   db.collection(name).doc(id?) -> { id, set(data, {merge}) }
//   db.runTransaction(fn) -> fn({ get(ref), set(ref, data, {merge}) })
// Integration/concurrency behavior is covered separately against the emulator.

function makeFakeFirestore() {
  const store = new Map();
  let autoSeq = 0;

  function docRef(collectionName, id) {
    const docId = id || `auto_${(autoSeq += 1)}`;
    const key = `${collectionName}/${docId}`;
    return {
      id: docId,
      _key: key,
      // Mirrors the Admin SDK: a document read outside a transaction.
      async get() {
        const data = store.get(key);
        return { exists: data !== undefined, id: docId, data: () => data };
      },
      async set(data, opts) {
        const prev = store.get(key);
        store.set(key, opts && opts.merge && prev ? { ...prev, ...data } : { ...data });
      },
    };
  }

  return {
    _store: store,
    collection(collectionName) {
      return { doc: (id) => docRef(collectionName, id) };
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
      };
      return fn(tx);
    },
  };
}

module.exports = { makeFakeFirestore };
