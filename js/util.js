// Small shared helpers: ids, dates, money, escaping.
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// FNV-1a with two seeds -> stable 16 hex chars. Used for deterministic ids so the
// same imported row / same-named category gets the same id on both phones.
export function hash(str) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate();
export const curMonth = () => today().slice(0, 7);
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const monthLabel = (ym, short) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-CA', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
};
export const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (iso === today()) return 'Today';
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: y === new Date().getFullYear() ? undefined : 'numeric' });
};

// Money is stored as integer cents.
const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const moneyRound = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
export const fmt = (cents) => money.format(cents / 100);
export const fmtRound = (cents) => moneyRound.format(Math.round(cents / 100));
export const fmtInput = (cents) => (cents ? (cents / 100).toFixed(2).replace(/\.00$/, '') : '');

// "1 234,50" / "1,234.50" / "12.5" -> cents (always >= 0), or null if not a number.
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
}
export const signOf = (text) => (/^\s*["']?\s*-/.test(String(text)) ? -1 : 1);
