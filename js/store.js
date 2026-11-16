// In-memory copy of all records, persisted to IndexedDB.
// Every record: { id, kind, updatedAt, deleted, dirty, ...fields }.
//   kind: 'tx' | 'cat' | 'budget' | 'rec' | 'settings'
// `dirty` marks records not yet pushed to the cloud. Deletes are tombstones so they sync too.
import { idb } from './db.js';

const recs = new Map();
const meta = {};
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = (source) => listeners.forEach((fn) => fn(source));

export async function init() {
  for (const r of await idb.allRecords()) recs.set(r.id, r);
  for (const k of ['sync', 'onboarded', 'lastBackup']) meta[k] = await idb.getMeta(k);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

export const all = (kind) => { const out = []; for (const r of recs.values()) if (r.kind === kind && !r.deleted) out.push(r); return out; };
export const get = (id) => { const r = recs.get(id); return r && !r.deleted ? r : null; };
export const raw = (id) => recs.get(id);
export const everything = () => [...recs.values()];
export const dirty = () => everything().filter((r) => r.dirty);
export const isEmpty = () => recs.size === 0;

const stamp = (rec, deleted = false) => ({
  ...rec, deleted, dirty: true,
  updatedAt: Math.max(Date.now(), (recs.get(rec.id)?.updatedAt || 0) + 1),
});

export async function saveMany(list, source = 'local') {
  const out = list.map((r) => stamp(r));
  out.forEach((r) => recs.set(r.id, r));
  await idb.putRecords(out);
  emit(source);
}
export const save = (rec) => saveMany([rec]);

export async function del(id) {
  const r = recs.get(id);
  if (!r) return;
  const t = stamp({ id: r.id, kind: r.kind }, true);
  recs.set(id, t);
  await idb.putRecords([t]);
  emit('local');
}

// Merge records coming from the cloud or a backup file: newest updatedAt wins.
export async function merge(list, { fromCloud }) {
  const out = [];
  for (const r of list) {
    const cur = recs.get(r.id);
    if (cur && cur.updatedAt > r.updatedAt) continue;
    if (cur && cur.updatedAt === r.updatedAt && !fromCloud) continue;
    out.push({ ...r, dirty: fromCloud ? false : true });
  }
  if (!out.length) return 0;
  out.forEach((r) => recs.set(r.id, r));
  await idb.putRecords(out);
  emit(fromCloud ? 'remote' : 'local');
  return out.length;
}

export async function markClean(pushed) {
  const out = [];
  for (const p of pushed) {
    const cur = recs.get(p.id);
    if (cur && cur.updatedAt === p.updatedAt && cur.dirty) { cur.dirty = false; out.push(cur); }
  }
  if (out.length) await idb.putRecords(out);
}

export async function markAllDirty() {
  const out = everything();
  out.forEach((r) => (r.dirty = true));
  await idb.putRecords(out);
}

export async function wipe() {
  recs.clear();
  await idb.clearRecords();
  emit('local');
}

export const getMeta = (k) => meta[k];
export async function setMeta(k, v) { meta[k] = v; await idb.setMeta(k, v); }
