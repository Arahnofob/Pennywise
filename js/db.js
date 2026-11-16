// Thin IndexedDB wrapper. Two stores: `records` (everything that syncs) and `meta` (device-local settings).
let dbp;
function open() {
  return (dbp ||= new Promise((res, rej) => {
    const rq = indexedDB.open('pennywise', 1);
    rq.onupgradeneeded = () => {
      rq.result.createObjectStore('records', { keyPath: 'id' });
      rq.result.createObjectStore('meta');
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const idb = {
  allRecords: () => tx('records', 'readonly', (s) => s.getAll()),
  putRecords: (list) => tx('records', 'readwrite', (s) => { for (const r of list) s.put(r); }),
  clearRecords: () => tx('records', 'readwrite', (s) => s.clear()),
  getMeta: (k) => tx('meta', 'readonly', (s) => s.get(k)),
  setMeta: (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k)),
};
