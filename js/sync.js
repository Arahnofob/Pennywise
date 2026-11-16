// Optional cloud sync through a free Supabase project (see supabase/schema.sql).
// Protocol: pull every row with seq > our cursor, then push our dirty records.
// Conflicts are resolved "newest edit wins", both here and in the database.
import * as store from './store.js';
import { t } from './i18n.js';

const LOCAL = ['id', 'kind', 'updatedAt', 'deleted', 'dirty'];
let running = null, again = false, timer = null;
export const status = { state: 'off', error: '', lastSync: 0 }; // off | idle | syncing | error
const subs = new Set();
export const onStatus = (fn) => subs.add(fn);
const set = (patch) => { Object.assign(status, patch); subs.forEach((fn) => fn()); };

export const config = () => store.getMeta('sync') || null;
export const enabled = () => !!config()?.url;

export const newHousehold = () => {
  const a = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_');
};
export const pairingCode = () => {
  const c = config();
  return 'PW1.' + btoa(JSON.stringify({ u: c.url, k: c.key, h: c.household }));
};
export function parsePairing(code) {
  try {
    const o = JSON.parse(atob(code.trim().replace(/^PW1\./, '')));
    if (o.u && o.k && o.h) return { url: o.u, key: o.k, household: o.h };
  } catch {}
  return null;
}

async function rpc(cfg, fn, body) {
  const res = await fetch(`${cfg.url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.message || j.msg || j.error || msg; } catch {}
    if (res.status === 404) msg = t('Sync tables not found. Run supabase/schema.sql in your Supabase project.');
    if (res.status === 401) msg = t('The API key was rejected. Check the Supabase URL and anon key.');
    throw new Error(msg);
  }
  return res.json();
}

async function cycle(cfg) {
  let cursor = cfg.cursor || 0;
  for (;;) {
    const rows = await rpc(cfg, 'pw_pull', { p_household: cfg.household, p_since: cursor, p_limit: 1000 });
    if (rows.length) {
      await store.merge(rows.map((r) => ({ ...r.data, id: r.id, kind: r.kind, updatedAt: Number(r.updated_at), deleted: r.deleted })), { fromCloud: true });
      cursor = Number(rows[rows.length - 1].seq);
      await store.setMeta('sync', { ...config(), cursor });
    }
    if (rows.length < 1000) break;
  }
  const pending = store.dirty().map((r) => ({ ...r }));
  for (let i = 0; i < pending.length; i += 500) {
    const chunk = pending.slice(i, i + 500);
    await rpc(cfg, 'pw_push', {
      p_household: cfg.household,
      p_rows: chunk.map((r) => {
        const data = {};
        for (const k in r) if (!LOCAL.includes(k)) data[k] = r[k];
        return { id: r.id, kind: r.kind, data, updated_at: r.updatedAt, deleted: !!r.deleted };
      }),
    });
    await store.markClean(chunk);
  }
}

export function syncNow() {
  const cfg = config();
  if (!cfg?.url) { set({ state: 'off' }); return Promise.resolve(false); }
  if (running) { again = true; return running; }
  set({ state: 'syncing', error: '' });
  running = cycle(cfg)
    .then(() => { set({ state: 'idle', lastSync: Date.now() }); return true; })
    .catch((e) => { set({ state: 'error', error: navigator.onLine === false ? t('Offline. Will retry when you are back online.') : (e.message || String(e)) }); return false; })
    .finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}

export const schedule = (ms = 1500) => { if (!enabled()) return; clearTimeout(timer); timer = setTimeout(syncNow, ms); };

export async function connect(cfg) {
  await store.setMeta('sync', { ...cfg, cursor: 0 });
  await store.markAllDirty();
  return syncNow();
}
export async function disconnect() { await store.setMeta('sync', null); set({ state: 'off', error: '' }); }

export function start() {
  store.onChange((src) => { if (src === 'local') schedule(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(200); });
  addEventListener('online', () => schedule(200));
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
  if (enabled()) syncNow();
}
