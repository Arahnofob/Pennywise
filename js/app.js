// Pennywise UI: state, views, sheets and event handling.
import * as store from './store.js';
import * as sync from './sync.js';
import * as lock from './lock.js';
import { t, lang, setLang, locale } from './i18n.js';
import { mapMonefy, toCSV, catId, guessIcon } from './csv.js';
import { categoryBars, trendChart } from './charts.js';
import { uid, esc, fmt, fmtInput, parseAmount, today, curMonth, addMonths, daysInMonth, monthLabel, monthName, dayLabel, num, isoDate } from './util.js';

const $ = (s) => document.querySelector(s);
const ui = { tab: 'home', month: curMonth(), year: curMonth().slice(0, 4), q: '', filterCat: null, trendSel: null, sheet: null };

const DEFAULT_CATS = [
  ['Groceries', 'expense', '🛒'], ['Eating out', 'expense', '☕'], ['Home', 'expense', '🏠'], ['Bills', 'expense', '🧾'],
  ['Car', 'expense', '🚗'], ['Transport', 'expense', '🚌'], ['Health', 'expense', '💊'], ['Clothes', 'expense', '👕'],
  ['Fun', 'expense', '🎬'], ['Gifts', 'expense', '🎁'], ['Phone', 'expense', '📱'], ['Pets', 'expense', '🐾'],
  ['Investments', 'expense', '📈'], ['Salary', 'income', '💼'], ['Other income', 'income', '💰'],
];
// Emoji picker for categories and goals, grouped by theme. Any other emoji can be typed in the box below it.
const ICON_GROUPS = [
  ['Food & drink', '🛒 🍎 🥦 🥩 🍞 🧀 🥚 🥛 🍕 🍔 🌮 🍣 🍜 🥗 🍰 🍩 🍫 🍿 🍽️ ☕ 🧋 🍺 🍷 🍸'],
  ['Home & bills', '🏠 🏡 🏢 🔑 🛋️ 🛏️ 🧹 🧺 🧻 🪴 🛠️ 🔧 💡 🔥 💧 🧾 📄 🌐 📡 📱 💻 📺 🔌 🗑️'],
  ['Transport & travel', '🚗 🚙 ⛽ 🔋 🅿️ 🚌 🚇 🚆 🚕 🚲 🛴 🛵 ✈️ 🧳 🏨 🏖️ ⛰️ 🏕️ 🗺️ 🚢 🛞 🧽 🪪 🎫'],
  ['Health & care', '💊 🩺 🏥 🦷 👓 🧴 🧼 🪥 💇 💅 💄 🧖 🩹 🧘 🏋️ 🏃 🚴 🏊 ⚽ 🎾 🥊 ⛷️ 🛌 ❤️'],
  ['Shopping', '🛍️ 👕 👖 👗 👟 👠 🧥 🧣 👜 🎒 💍 ⌚ 🕶️ 🎁 📦 🏷️ 🧸 🪑 🖥️ 🎧 📷 🖨️ ✂️ 🧵'],
  ['Fun & hobbies', '🎬 🎮 🎲 🎨 🎸 🎹 🎤 🎟️ 🎭 🎳 📚 📖 📰 🎵 🧩 🎣 🪁 🎉 🎂 🎄 🎃 🌸 ⛳ 🃏'],
  ['Family & pets', '👶 🍼 🧒 👨‍👩‍👧 💑 💒 👵 🎓 🏫 ✏️ 🐶 🐱 🐾 🐟 🐦 🐰 🦴 🐠 🌱 🌻 🙏 ⛪ 🕯️ 🤝'],
  ['Money & work', '💰 💵 💳 🏦 🐖 📈 📉 💼 🧑‍💻 🏗️ 📊 🪙 💸 🧮 📝 📅 🛟 🎯 🏆 ⭐ 🔒 ⚖️ 🏛️ 🧑‍⚕️'],
].map(([name, list]) => [name, list.split(' ')]);
const firstGrapheme = (s) => {
  s = (s || '').trim();
  if (!s) return '';
  try { return new Intl.Segmenter().segment(s)[Symbol.iterator]().next().value.segment; } catch { return Array.from(s)[0]; }
};
const pickedIcon = (d, fallback) => firstGrapheme(d.iconText) || d.icon || fallback;

/* ---------- data helpers ---------- */
// Hidden categories stay on past transactions but are not offered for new ones.
const allCats = (type) => store.all('cat').filter((c) => !type || c.type === type).sort((a, b) => a.name.localeCompare(b.name));
const cats = (type) => allCats(type).filter((c) => !c.hidden);
const catUses = (id) => txs().filter((x) => x.catId === id).length + store.all('rec').filter((r) => r.catId === id).length;
const catOf = (id) => store.get(id) || { name: t('Uncategorized'), icon: '❓' };
const people = () => store.get('settings')?.people || [];
const txs = () => store.all('tx');
const sum = (list, type) => list.reduce((s, x) => s + (x.type === type ? x.amount : 0), 0);
const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0);
const signed = (n) => `${n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

// Recurring payments are either monthly (on a day of the month) or every 2 weeks (from a first date).
// Each generated transaction's id comes from the rule and its date, so two phones never create duplicates,
// and a generated payment you delete stays deleted.
// Weekly and every-2-weeks rules repeat a fixed number of days from their first payment date.
const STEP = { weekly: 7, biweekly: 14 };
const isBiweekly = (r) => !!STEP[r.freq] && /^\d{4}-\d{2}-\d{2}$/.test(r.first || '');
const freqLabel = (f) => (f === 'weekly' ? t('Every week') : t('Every 2 weeks'));
function biweeklyDates(r, until, limit = 2000) {
  const [y, m, d] = r.first.split('-').map(Number), out = [];
  for (let k = 0; k < limit; k++) { const date = isoDate(new Date(y, m - 1, d + STEP[r.freq] * k)); if (date > until) break; out.push(date); }
  return out;
}
const monthlyDate = (r, m) => `${m}-${String(Math.min(r.day, daysInMonth(m))).padStart(2, '0')}`;

function nextRun(r) {
  const now = today();
  if (isBiweekly(r)) {
    const [y, m, d] = r.first.split('-').map(Number);
    for (let k = 0; k < 5000; k++) { const date = isoDate(new Date(y, m - 1, d + STEP[r.freq] * k)); if (date > now) return date; }
    return null;
  }
  for (let m = curMonth(), i = 0; i < 3; i++, m = addMonths(m, 1)) { const date = monthlyDate(r, m); if (date > now && date >= (r.startDate || '')) return date; }
  return null;
}

async function runRecurring() {
  const out = [], now = today(), cm = curMonth();
  const add = (r, id, date) => out.push({ id, kind: 'tx', date, type: r.type, amount: r.amount, catId: r.catId, note: r.note, who: r.who || '', recId: r.id });
  for (const r of store.all('rec')) {
    if (!r.active) continue;
    if (isBiweekly(r)) {
      for (const date of biweeklyDates(r, now)) { const id = `tx:${r.id}:${date}`; if (!store.raw(id)) add(r, id, date); }
      continue;
    }
    for (let m = r.start; m <= cm; m = addMonths(m, 1)) {
      const date = monthlyDate(r, m), id = `tx:${r.id}:${m}`;
      if (date > now || date < r.startDate || store.raw(id)) continue;
      add(r, id, date);
    }
  }
  if (out.length) await store.saveMany(out);
  return out.length;
}

// One-time addition of an Investments expense category for people who started before it existed.
// The id is fixed, so both phones create the same category, and if you delete or hide it, it stays that way.
async function ensureInvestments() {
  const id = catId('Investments', 'expense');
  if (store.raw(id) || store.isEmpty() || allCats('expense').some((c) => /invest|інвест/i.test(c.name))) return;
  await store.save({ id, kind: 'cat', name: t('Investments'), type: 'expense', icon: '📈' });
}

/* ---------- chrome ---------- */
const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TABS = [
  ['home', 'Overview', svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')],
  ['list', 'Transactions', svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>')],
  ['add'],
  ['plan', 'Plan', svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>')],
  ['more', 'More', svg('<path d="M5 12h.01M12 12h.01M19 12h.01"/>')],
];
const firstYear = () => txs().reduce((m, x) => (x.date < m ? x.date : m), today()).slice(0, 4);

function renderChrome() {
  const st = sync.status, thisYear = curMonth().slice(0, 4);
  const switcher = ui.tab === 'year' ? `<div class="month">
      <button data-act="year" data-v="-1" aria-label="${t('Previous year')}" ${ui.year <= firstYear() ? 'disabled' : ''}>‹</button>
      <button class="month-name" data-act="year-now">${ui.year}</button>
      <button data-act="year" data-v="1" aria-label="${t('Next year')}" ${ui.year >= thisYear ? 'disabled' : ''}>›</button>
    </div>` : ui.tab !== 'more' ? `<div class="month">
      <button data-act="month" data-v="-1" aria-label="${t('Previous month')}">‹</button>
      <button class="month-name" data-act="month-now">${monthLabel(ui.month)}</button>
      <button data-act="month" data-v="1" aria-label="${t('Next month')}" ${ui.month >= curMonth() ? 'disabled' : ''}>›</button>
    </div>` : '';
  $('#top').innerHTML = `
    <div class="brand"><img src="icons/icon.svg" alt="" width="26" height="26"><span>Pennywise</span>
      ${sync.enabled() ? `<button class="sync-pill ${st.state}" data-act="open-sync" aria-label="${t('Sync status')}">${st.state === 'syncing' ? t('Syncing…') : st.state === 'error' ? t('⚠ Sync issue') : t('✓ Synced')}</button>` : ''}
    </div>${switcher}`;
  const active = ui.tab === 'year' ? 'home' : ui.tab;
  $('#tabs').innerHTML = TABS.map(([id, label, glyph]) => id === 'add'
    ? `<button class="fab" data-act="new-tx" aria-label="${t('Add transaction')}">+</button>`
    : `<button class="tab ${active === id ? 'on' : ''}" data-act="tab" data-v="${id}" ${active === id ? 'aria-current="page"' : ''}>${glyph}${t(label)}</button>`).join('');
}

/* ---------- views ---------- */
function txRow(x) {
  const c = catOf(x.catId);
  const sub = [x.note ? c.name : '', x.who, x.recId ? t('recurring') : ''].filter(Boolean).join(' · ');
  return `<button class="tx" data-act="edit-tx" data-id="${esc(x.id)}">
    <span class="ico" aria-hidden="true">${esc(c.icon)}</span>
    <span class="tx-main"><span class="tx-title">${esc(x.note || c.name)}</span>${sub ? `<span class="tx-sub">${esc(sub)}</span>` : ''}</span>
    <span class="amt ${x.type}">${x.type === 'expense' ? '−' : '+'}${fmt(x.amount)}</span>
  </button>`;
}

function txGroups(list) {
  let html = '', day = null, buf = [];
  const flush = () => {
    if (!buf.length) return;
    const net = sum(buf, 'income') - sum(buf, 'expense');
    html += `<div class="day"><span>${dayLabel(day)}</span><span class="${net < 0 ? 'neg' : 'pos'}">${net < 0 ? '−' : '+'}${fmt(Math.abs(net))}</span></div><div class="card list">${buf.map(txRow).join('')}</div>`;
    buf = [];
  };
  for (const x of list) { if (x.date !== day) { flush(); day = x.date; } buf.push(x); }
  flush();
  return html;
}

function spendByCat(list) {
  const m = new Map();
  for (const x of list) if (x.type === 'expense') m.set(x.catId, (m.get(x.catId) || 0) + x.amount);
  return [...m].map(([id, amount]) => { const c = catOf(id); return { id, amount, name: c.name, icon: c.icon }; }).sort((a, b) => b.amount - a.amount);
}

function viewHome() {
  const all = txs(), list = all.filter((x) => x.date.startsWith(ui.month));
  const inc = sum(list, 'income'), exp = sum(list, 'expense');
  const spend = spendByCat(list);
  const months = [];
  for (let i = 5; i >= 0; i--) months.push({ month: addMonths(ui.month, -i), income: 0, expense: 0 });
  const idx = new Map(months.map((m) => [m.month, m]));
  for (const x of all) { const m = idx.get(x.date.slice(0, 7)); if (m) m[x.type] += x.amount; }

  const budgets = store.all('budget');
  let budgetStrip = '';
  if (budgets.length) {
    const limit = budgets.reduce((s, b) => s + b.limit, 0);
    const used = budgets.reduce((s, b) => s + (spend.find((c) => c.id === b.catId)?.amount || 0), 0);
    const left = limit - used;
    budgetStrip = `<button class="card strip" data-act="tab" data-v="plan">
      <span><b>${left >= 0 ? t('{0} left', fmt(left)) : t('⚠ {0} over', fmt(-left))}</b> ${t('of {0} budgeted', fmt(limit))}</span>
      <span class="track"><span class="fill ${left < 0 ? 'over' : ''}" style="width:${Math.min((used / (limit || 1)) * 100, 100)}%"></span></span>
    </button>`;
  }
  const ppl = people();
  let byPerson = '';
  if (ppl.length && list.some((x) => x.who && x.type === 'expense')) {
    const rows = [...ppl, ''].map((p) => ({ name: p || t('Shared / not set'), amount: list.reduce((s, x) => s + (x.type === 'expense' && (x.who || '') === p ? x.amount : 0), 0) })).filter((r) => r.amount);
    const max = Math.max(...rows.map((r) => r.amount));
    byPerson = `<h2>${t('Spending by person')}</h2><div class="card pad"><div class="bars">${rows.map((r) => `
      <div class="bar-row static"><span class="bar-main"><span class="bar-head"><span class="bar-name">${esc(r.name)}</span><span class="bar-val">${fmt(r.amount)}</span></span>
      <span class="track"><span class="fill" style="width:${(r.amount / max) * 100}%"></span></span></span></div>`).join('')}</div></div>`;
  }

  return `
    <section class="hero">
      <div class="hero-label">${t('Balance for {0}', monthLabel(ui.month))}</div>
      <div class="hero-num ${inc - exp < 0 ? 'neg' : 'pos'}">${inc - exp < 0 ? '−' : '+'}${fmt(Math.abs(inc - exp))}</div>
      <div class="hero-pair">
        <div><span>${t('Income')}</span><b class="pos">+${fmt(inc)}</b></div>
        <div><span>${t('Expenses')}</span><b class="neg">−${fmt(exp)}</b></div>
      </div>
    </section>
    ${budgetStrip}
    <h2>${t('Spending by category')}</h2>
    ${spend.length ? `<div class="card pad">${categoryBars(spend)}</div>` : `<div class="card empty">${t('No expenses in this period yet.')}<br>${t('Tap + to add one.')}</div>`}
    ${byPerson}
    <h2>${t('Last 6 months')}</h2>
    <div class="card pad">${trendChart(months, ui.trendSel && idx.has(ui.trendSel) ? ui.trendSel : ui.month)}</div>
    <button class="card year-link" data-act="open-year"><span>${t('Year in review: {0}', ui.month.slice(0, 4))}</span><span class="chev">›</span></button>
    ${list.length ? `<h2>${t('Latest')}</h2><div class="card list">${[...list].sort(byNewest).slice(0, 5).map(txRow).join('')}</div>
      <button class="link" data-act="tab" data-v="list">${t('See all transactions ({0})', list.length)}</button>` : ''}`;
}

function viewYear() {
  const y = ui.year, cm = curMonth(), all = txs();
  const list = all.filter((x) => x.date.startsWith(y));
  const back = `<button class="back" data-act="tab" data-v="home">${t('‹ Back to months')}</button>`;
  if (!list.length) return `${back}<div class="card empty">${t('No transactions in {0}.', y)}</div>`;
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, income: 0, expense: 0, n: 0 }));
  for (const x of list) { const m = months[Number(x.date.slice(5, 7)) - 1]; m[x.type] += x.amount; m.n++; }
  const inc = sum(list, 'income'), exp = sum(list, 'expense'), net = inc - exp;
  const active = months.filter((m) => m.n && m.month <= cm);
  const avg = exp / (active.length || 1);
  const full = active.filter((m) => m.month < cm);              // the running month would always look "cheapest"
  const ranked = [...(full.length ? full : active)].sort((a, b) => b.expense - a.expense);
  const top = [...active].sort((a, b) => b.expense - a.expense)[0], low = ranked[ranked.length - 1];
  const big = list.filter((x) => x.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
  const prevY = String(Number(y) - 1), prev = all.filter((x) => x.date.startsWith(prevY));
  let cmp = '';
  if (prev.length) {
    const pAvg = sum(prev, 'expense') / (new Set(prev.map((x) => x.date.slice(0, 7))).size || 1);
    const pct = pAvg ? Math.round(((avg - pAvg) / pAvg) * 100) : 0;
    cmp = pct > 0 ? t('{0}% more than in {1}', pct, prevY) : pct < 0 ? t('{0}% less than in {1}', -pct, prevY) : t('same as in {0}', prevY);
  }
  const stat = (label, value, sub = '', cls = '') => `<div class="stat ${cls}"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const sel = ui.trendSel?.startsWith(y) ? ui.trendSel : (active[active.length - 1] || months[0]).month;
  return `${back}
    <section class="hero">
      <div class="hero-label">${net >= 0 ? t('Saved in {0}', y) : t('Overspent in {0}', y)}</div>
      <div class="hero-num ${net < 0 ? 'neg' : 'pos'}">${net < 0 ? '−' : '+'}${fmt(Math.abs(net))}</div>
      <div class="hero-pair">
        <div><span>${t('Income')}</span><b class="pos">+${fmt(inc)}</b></div>
        <div><span>${t('Expenses')}</span><b class="neg">−${fmt(exp)}</b></div>
      </div>
    </section>
    <div class="stats">
      ${stat(t('Average monthly spending'), fmt(avg), cmp)}
      ${stat(t('Savings rate'), inc ? Math.round((net / inc) * 100) + '%' : '—', t('of income kept'))}
      ${top ? stat(t('Most expensive month'), esc(monthName(top.month)), fmt(top.expense)) : ''}
      ${low && low !== top ? stat(t('Cheapest month'), esc(monthName(low.month)), fmt(low.expense)) : ''}
      ${big ? stat(t('Biggest expense'), fmt(big.amount), esc(`${big.note || catOf(big.catId).name} · ${dayLabel(big.date)}`), 'wide') : ''}
    </div>
    <h2>${t('Month by month')}</h2>
    <div class="card pad">${trendChart(months, sel)}</div>
    <h2>${t('Where the money went')}</h2>
    <div class="card pad">${categoryBars(spendByCat(list), false)}</div>`;
}

function viewList() {
  const q = ui.q.trim().toLowerCase();
  let list = txs();
  if (!q) list = list.filter((x) => x.date.startsWith(ui.month));
  if (ui.filterCat) list = list.filter((x) => x.catId === ui.filterCat);
  if (q) list = list.filter((x) => `${x.note} ${catOf(x.catId).name} ${x.who || ''} ${(x.amount / 100).toFixed(2)}`.toLowerCase().includes(q));
  list.sort(byNewest);
  const shown = list.slice(0, 300);
  const fc = ui.filterCat && catOf(ui.filterCat);
  return `
    <div class="search"><input type="search" id="q" placeholder="${t('Search all transactions')}" value="${esc(ui.q)}" aria-label="${t('Search transactions')}" autocomplete="off"></div>
    <div id="list-body">
    ${fc ? `<button class="chip on" data-act="clear-filter">${esc(fc.icon)} ${esc(fc.name)} ✕</button>` : ''}
    <div class="totals"><span>${t('Transactions: {0}', num(list.length))}${q ? ' ' + t('(all months)') : ''}</span>
      <span><span class="pos">+${fmt(sum(list, 'income'))}</span> &nbsp; <span class="neg">−${fmt(sum(list, 'expense'))}</span></span></div>
    ${shown.length ? txGroups(shown) : `<div class="card empty">${q || fc ? t('Nothing matches.') : t('No transactions in {0}.', monthLabel(ui.month))}</div>`}
    ${list.length > shown.length ? `<p class="hint">${t('Showing the newest 300. Refine the search to see older ones.')}</p>` : ''}
    </div>`;
}

function goalRow(g) {
  const left = g.target - g.saved, pct = Math.min((g.saved / g.target) * 100, 100);
  let note = left <= 0 ? t('Reached 🎉') : t('{0} to go', fmt(left));
  if (left > 0 && g.deadline) {
    const dm = g.deadline.slice(0, 7), cm = curMonth();
    if (dm < cm) note += ' · ' + t('Target date has passed');
    else {
      const [y1, m1] = cm.split('-').map(Number), [y2, m2] = dm.split('-').map(Number);
      note = t('{0} a month to reach it by {1}', fmt(Math.ceil(left / ((y2 - y1) * 12 + (m2 - m1) + 1))), monthLabel(dm));
    }
  }
  return `<button class="budget" data-act="edit-goal" data-id="${esc(g.id)}">
    <span class="ico" aria-hidden="true">${esc(g.icon || '🎯')}</span>
    <span class="bar-main">
      <span class="bar-head"><span class="bar-name">${esc(g.name)}</span><span class="bar-val">${fmt(g.saved)} <small>${t('of {0}', fmt(g.target))}</small></span></span>
      <span class="track"><span class="fill goal" style="width:${Math.max(pct, g.saved ? 1.5 : 0)}%"></span></span>
      <span class="budget-note">${Math.floor(pct)}% · ${esc(note)}</span>
    </span></button>`;
}

function viewPlan() {
  const list = txs().filter((x) => x.date.startsWith(ui.month));
  const spent = new Map(spendByCat(list).map((c) => [c.id, c.amount]));
  const limits = new Map(store.all('budget').map((b) => [b.catId, b.limit]));
  const rows = cats('expense').map((c) => ({ c, limit: limits.get(c.id) || 0, used: spent.get(c.id) || 0 }));
  const withB = rows.filter((r) => r.limit).sort((a, b) => b.used / b.limit - a.used / a.limit);
  const without = rows.filter((r) => !r.limit).sort((a, b) => b.used - a.used);
  const row = ({ c, limit, used }) => {
    const left = limit - used;
    return `<button class="budget" data-act="edit-budget" data-id="${esc(c.id)}">
      <span class="ico" aria-hidden="true">${esc(c.icon)}</span>
      <span class="bar-main">
        <span class="bar-head"><span class="bar-name">${esc(c.name)}</span><span class="bar-val">${fmt(used)}${limit ? ` <small>${t('of {0}', fmt(limit))}</small>` : ''}</span></span>
        ${limit ? `<span class="track"><span class="fill ${left < 0 ? 'over' : ''}" style="width:${Math.min((used / limit) * 100, 100)}%"></span></span>
        <span class="budget-note ${left < 0 ? 'over' : ''}">${left < 0 ? t('⚠ Over by {0}', fmt(-left)) : t('{0} left', fmt(left))}</span>` : `<span class="budget-note">${t('No budget · tap to set')}</span>`}
      </span></button>`;
  };
  const goals = store.all('goal').sort((a, b) => (a.saved >= a.target) - (b.saved >= b.target) || a.name.localeCompare(b.name));
  return `
    <h2>${t('Savings goals')}</h2>
    <div class="card list">${goals.map(goalRow).join('')}
      <button class="tx" data-act="new-goal"><span class="ico" aria-hidden="true">＋</span><span class="tx-main"><span class="tx-title">${t('Add savings goal')}</span><span class="tx-sub">${t('A trip, a car, an emergency fund…')}</span></span><span class="chev">›</span></button>
    </div>
    ${!rows.length ? `<h2>${t('Budgets')}</h2><div class="card empty">${t('Add an expense category first, then set a monthly limit for it here.')}</div>` : `
    <h2>${t('Budgets for {0}', monthLabel(ui.month))}</h2>
    ${withB.length ? `<div class="card list">${withB.map(row).join('')}</div>` : `<div class="card empty">${t('No budgets yet. Tap a category below to set a monthly limit.')}</div>`}
    ${without.length ? `<h2>${t('Without a budget')}</h2><div class="card list">${without.map(row).join('')}</div>` : ''}`}`;
}

function viewMore() {
  const recs = store.all('rec').sort((a, b) => (nextRun(a) || '9999').localeCompare(nextRun(b) || '9999'));
  const st = sync.status, on = sync.enabled();
  const item = (act, icon, title, sub) => `<button class="tx" data-act="${act}"><span class="ico" aria-hidden="true">${icon}</span>
    <span class="tx-main"><span class="tx-title">${title}</span>${sub ? `<span class="tx-sub">${sub}</span>` : ''}</span><span class="chev">›</span></button>`;
  const syncSub = !on ? t('Off · data stays on this phone') : st.state === 'error' ? '⚠ ' + esc(st.error) : st.state === 'syncing' ? t('Syncing…')
    : t('On') + (st.lastSync ? ' · ' + t('last synced {0}', new Date(st.lastSync).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })) : '');
  return `
    <h2>${t('Recurring payments')}</h2>
    <div class="card list">
      ${recs.map((r) => { const c = catOf(r.catId); return `<button class="tx" data-act="edit-rec" data-id="${esc(r.id)}"><span class="ico" aria-hidden="true">${esc(c.icon)}</span>
        <span class="tx-main"><span class="tx-title">${esc(r.note || c.name)}</span><span class="tx-sub">${isBiweekly(r) ? freqLabel(r.freq) : t('Day {0} of every month', r.day)}${!r.active ? ' · ' + t('paused') : nextRun(r) ? ' · ' + t('next {0}', dayLabel(nextRun(r))) : ''}</span></span>
        <span class="amt ${r.type}">${r.type === 'expense' ? '−' : '+'}${fmt(r.amount)}</span></button>`; }).join('')}
      ${item('new-rec', '＋', t('Add recurring payment'), t('Rent, subscriptions, salary…'))}
    </div>
    <h2>${t('Categories')}</h2>
    <div class="card pad"><div class="cat-grid">
      ${cats().map((c) => `<button class="cat" data-act="edit-cat" data-id="${esc(c.id)}"><span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}
      <button class="cat add" data-act="new-cat"><span aria-hidden="true">＋</span>${t('New')}</button>
    </div>
    ${allCats().some((c) => c.hidden) ? `<div class="icon-group">${t('Hidden categories')}</div><div class="cat-grid">
      ${allCats().filter((c) => c.hidden).map((c) => `<button class="cat hidden-cat" data-act="edit-cat" data-id="${esc(c.id)}"><span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}</div>` : ''}
    </div>
    <h2>${t('Household')}</h2>
    <div class="card list">
      ${item('open-people', '👥', t('People'), people().length ? esc(people().join(', ')) : t('Add your names to track who paid'))}
      ${item('open-sync', '☁️', t('Sync between phones'), syncSub)}
    </div>
    <h2>${t('Settings')}</h2>
    <div class="card list">
      ${item('open-lang', '🌐', t('Language'), lang() === 'uk' ? 'Українська' : 'English')}
      ${item('open-lock', '🔒', t('App lock'), lock.isSet() ? t('On · PIN asked when you open the app') : t('Off'))}
    </div>
    <h2>${t('Your data')}</h2>
    <div class="card list">
      ${item('import-csv', '📥', t('Import from Monefy'), t('Pick the CSV file exported from Monefy'))}
      ${item('export-backup', '💾', t('Save a backup'), t('Everything in one file you can restore later'))}
      ${item('import-backup', '♻️', t('Restore a backup'), t('Merges a backup file into this phone'))}
      ${item('export-csv', '📄', t('Export as CSV'), t('Open your transactions in a spreadsheet'))}
      ${item('erase', '🗑️', t('Erase data on this phone'), '')}
    </div>
    <p class="hint">${t('Pennywise keeps your data on this phone. Transactions stored: {0}.', num(txs().length))}</p>`;
}

function viewWelcome() {
  return `<section class="welcome">
    <img src="icons/icon.svg" alt="" width="88" height="88">
    <h1>${t('Welcome to Pennywise')}</h1>
    <p>${t('A private money tracker for the two of you. Everything is stored on this phone.')}</p>
    <button class="btn primary" data-act="import-csv">${t('Import my Monefy history')}</button>
    <button class="btn" data-act="start-fresh">${t('Start fresh')}</button>
    <button class="btn ghost" data-act="open-sync">${t("Join my partner's Pennywise")}</button>
    <button class="btn ghost" data-act="toggle-lang">${lang() === 'uk' ? 'English' : 'Українська'}</button>
  </section>`;
}

function render() {
  const welcome = store.isEmpty() && !store.getMeta('onboarded');
  document.body.classList.toggle('welcome-mode', welcome);
  if (welcome) { $('#top').innerHTML = ''; $('#tabs').innerHTML = ''; $('#view').innerHTML = viewWelcome(); return; }
  renderChrome();
  const keep = ui.tab === 'list' && document.activeElement?.id === 'q';
  if (keep) { $('#list-body').outerHTML = viewList().match(/<div id="list-body">[\s\S]*$/)[0]; return; }
  $('#view').innerHTML = { home: viewHome, year: viewYear, list: viewList, plan: viewPlan, more: viewMore }[ui.tab]();
}

/* ---------- sheets ---------- */
const seg = (f, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-act="set" data-f="${f}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
const typeSeg = (d) => seg('type', d.type, [['expense', t('Expense')], ['income', t('Income.one')]]);
const catPicker = (d) => {
  const cur = d.catId && store.get(d.catId);
  const list = cats(d.type).concat(cur?.hidden && cur.type === d.type ? [cur] : []);
  return list.length ? `<div class="cat-grid pick">${list.map((c) => `<button type="button" class="cat ${d.catId === c.id ? 'on' : ''}" data-act="set" data-f="catId" data-v="${esc(c.id)}" aria-pressed="${d.catId === c.id}"><span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}</div>`
    : `<p class="hint">${t('No categories of this type yet. Add one under More → Categories.')}</p>`;
};
function catActions(d) {
  if (!d.id) return actions(d);
  const used = catUses(d.id), cur = store.get(d.id);
  const left = cur?.hidden ? `<button type="button" class="btn" data-act="cat-hide" data-v="0">${t('Show again')}</button>`
    : used ? `<button type="button" class="btn" data-act="cat-hide" data-v="1">${t('Hide')}</button>`
    : `<button type="button" class="btn danger" data-act="sheet-delete">${t('Delete')}</button>`;
  const hint = cur?.hidden ? t('Hidden: past transactions keep it, but it is not offered when adding new ones.')
    : used ? t('Used by {0} entries, so it can only be hidden: past transactions keep it, and it is no longer offered for new ones.', num(used)) : '';
  return `${hint ? `<p class="hint">${hint}</p>` : ''}<div class="actions">${left}<button type="submit" class="btn primary">${t('Save')}</button></div>`;
}
const whoPicker = (d) => people().length ? `<label>${t('Who')}</label>${seg('who', d.who || '', [['', t('Shared')], ...people().map((p) => [esc(p), esc(p)])])}` : '';
const amountField = (d, f = 'amountText') => `<div class="amount"><span>$</span><input data-f="${f}" inputmode="decimal" placeholder="0.00" value="${esc(d[f] || '')}" aria-label="${t('Amount in Canadian dollars')}" autocomplete="off"></div>`;
const moneyInput = (d, f, id) => `<input id="${id}" data-f="${f}" inputmode="decimal" placeholder="0.00" value="${esc(d[f] || '')}" autocomplete="off">`;
const iconGrid = (d) => `<div class="icon-picker">${ICON_GROUPS.map(([name, list]) => `<div class="icon-group">${t(name)}</div>
    <div class="icon-grid">${list.map((i) => `<button type="button" class="${d.icon === i && !d.iconText ? 'on' : ''}" data-act="set" data-f="icon" data-v="${i}" aria-pressed="${d.icon === i}">${i}</button>`).join('')}</div>`).join('')}</div>
    <div class="icon-custom"><span class="icon-now" aria-hidden="true">${esc(pickedIcon(d, '🏷️'))}</span>
    <input data-f="iconText" value="${esc(d.iconText || '')}" placeholder="${t('Or type any emoji')}" aria-label="${t('Or type any emoji')}" autocomplete="off" maxlength="16"></div>`;
const actions = (d, label = t('Save')) => `<div class="actions">${d.id ? `<button type="button" class="btn danger" data-act="sheet-delete">${t('Delete')}</button>` : ''}<button type="submit" class="btn primary">${label}</button></div>`;

const SHEETS = {
  tx: (d) => [d.id ? t('Edit transaction') : t('New transaction'), `
    ${typeSeg(d)}${amountField(d)}
    <label>${t('Category')}</label>${catPicker(d)}
    <div class="row2"><div><label for="f-date">${t('Date')}</label><input id="f-date" type="date" data-f="date" value="${esc(d.date)}" max="2100-12-31" required></div>
    <div><label for="f-note">${t('Note')}</label><input id="f-note" data-f="note" value="${esc(d.note || '')}" placeholder="${t('Optional')}" autocomplete="off" maxlength="120"></div></div>
    ${whoPicker(d)}${actions(d)}`],
  rec: (d) => [d.id ? t('Edit recurring payment') : t('New recurring payment'), `
    ${typeSeg(d)}${amountField(d)}
    <label>${t('Category')}</label>${catPicker(d)}
    <label>${t('How often')}</label>${seg('freq', d.freq, [['weekly', t('Every week')], ['biweekly', t('Every 2 weeks')], ['monthly', t('Monthly')]])}
    <div class="row2"><div>${STEP[d.freq]
      ? `<label for="f-first">${t('First payment')}</label><input id="f-first" type="date" data-f="first" value="${esc(d.first || '')}" max="2100-12-31" required>`
      : `<label for="f-day">${t('Day of month')}</label><input id="f-day" type="number" min="1" max="31" data-f="day" value="${esc(d.day)}" inputmode="numeric" required>`}</div>
    <div><label for="f-note">${t('Name')}</label><input id="f-note" data-f="note" value="${esc(d.note || '')}" placeholder="${t('e.g. Rent')}" autocomplete="off" maxlength="120"></div></div>
    ${whoPicker(d)}
    <label>${t('Status')}</label>${seg('active', d.active ? '1' : '0', [['1', t('Active')], ['0', t('Paused')]])}
    <p class="hint">${d.freq === 'weekly' ? t('Repeats every 7 days from the first payment. If that date is in the past, the payments since then are added right away.') : d.freq === 'biweekly' ? t('Repeats every 14 days from the first payment. If that date is in the past, the payments since then are added right away.') : t('Added automatically each month, starting the next time that day comes around.')}</p>${actions(d)}`],
  budget: (d) => [t('Budget for {0}', esc(catOf(d.catId).name)), `
    <label>${t('Monthly limit')}</label>${amountField(d)}
    <p class="hint">${t('Leave empty and save to remove the budget.')}</p>${actions({})}`],
  goal: (d) => [d.id ? t('Edit savings goal') : t('New savings goal'), `
    <label for="f-name">${t('Name')}</label><input id="f-name" data-f="name" value="${esc(d.name || '')}" placeholder="${t('e.g. Vacation')}" required maxlength="40" autocomplete="off">
    <div class="row2"><div><label for="f-target">${t('Target amount')}</label>${moneyInput(d, 'targetText', 'f-target')}</div>
    <div><label for="f-saved">${t('Saved so far')}</label>${moneyInput(d, 'savedText', 'f-saved')}</div></div>
    ${d.id ? `<label for="f-add">${t('Add to it now')}</label>${moneyInput(d, 'addText', 'f-add')}` : ''}
    <label for="f-deadline">${t('Target date (optional)')}</label><input id="f-deadline" type="date" data-f="deadline" value="${esc(d.deadline || '')}" max="2100-12-31">
    <label>${t('Icon')}</label>${iconGrid(d)}${actions(d)}`],
  cat: (d) => [d.id ? t('Edit category') : t('New category'), `
    ${d.id ? '' : typeSeg(d)}
    <label for="f-name">${t('Name')}</label><input id="f-name" data-f="name" value="${esc(d.name || '')}" required maxlength="40" autocomplete="off">
    <label>${t('Icon')}</label>${iconGrid(d)}${catActions(d)}`],
  people: (d) => [t('People'), `
    <label for="f-p1">${t('First person')}</label><input id="f-p1" data-f="p1" value="${esc(d.p1 || '')}" maxlength="24" autocomplete="off">
    <label for="f-p2">${t('Second person')}</label><input id="f-p2" data-f="p2" value="${esc(d.p2 || '')}" maxlength="24" autocomplete="off">
    <p class="hint">${t('With names set, every transaction can be marked with who paid. Use the same names on both phones.')}</p>${actions({})}`],
  lang: () => [t('Language'), seg('lang', lang(), [['en', 'English'], ['uk', 'Українська']])],
  lock: (d) => [t('App lock'), `
    <label for="f-pin1">${t('New PIN (4 digits)')}</label><input id="f-pin1" data-f="pin1" type="password" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(d.pin1 || '')}">
    <label for="f-pin2">${t('Repeat PIN')}</label><input id="f-pin2" data-f="pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(d.pin2 || '')}">
    <p class="hint">${t('Pennywise will ask for this PIN when you open it. The PIN keeps people holding your phone out of the app; it is set separately on each phone.')}</p>
    <div class="actions">${lock.isSet() ? `<button type="button" class="btn danger" data-act="lock-off">${t('Turn off lock')}</button>` : ''}<button type="submit" class="btn primary">${lock.isSet() ? t('Change PIN') : t('Turn on app lock')}</button></div>`],
  import: (d) => [t('Import from Monefy'), `
    <div class="summary"><div><b>${num(d.txs.length)}</b> ${t('transactions')}</div><div><b>${d.cats.length}</b> ${t('categories')}</div></div>
    <p>${t('From {0} to {1}.', dayLabel(d.from), dayLabel(d.to))}</p>
    ${d.dupes ? `<p class="hint">${t('Already in Pennywise and will be skipped: {0}.', num(d.dupes))}</p>` : ''}
    ${d.skipped ? `<p class="hint">${t('Rows that could not be read: {0}.', d.skipped)}</p>` : ''}
    <div class="actions"><button type="submit" class="btn primary">${d.txs.length - d.dupes ? t('Import transactions ({0})', num(d.txs.length - d.dupes)) : t('Nothing new to import')}</button></div>`],
  confirm: (d) => [d.title, `<p>${d.text}</p><div class="actions"><button type="button" class="btn" data-act="close-sheet">${t('Cancel')}</button><button type="submit" class="btn danger">${d.ok}</button></div>`],
  sync: (d) => sync.enabled() ? [t('Sync between phones'), `
    <p class="status ${sync.status.state}">${sync.status.state === 'error' ? '⚠ ' + esc(sync.status.error) : sync.status.state === 'syncing' ? t('Syncing….long') : t('✓ Sync is on. Changes appear on the other phone within a minute.')}</p>
    <label for="f-code">${t('Pairing code for the other phone')}</label>
    <textarea id="f-code" readonly rows="4">${esc(sync.pairingCode())}</textarea>
    <p class="hint">${t('On the other phone open More → Sync between phones and paste this code. Keep it private: anyone with the code can see your data.')}</p>
    <div class="actions"><button type="button" class="btn danger" data-act="sync-off">${t('Turn off')}</button><button type="button" class="btn" data-act="copy-code">${t('Copy code')}</button><button type="button" class="btn primary" data-act="sync-now">${t('Sync now')}</button></div>`]
    : [t('Sync between phones'), `
    ${seg('mode', d.mode, [['join', t('I have a pairing code')], ['new', t('Set up first phone')]])}
    ${d.mode === 'join' ? `<label for="f-code">${t('Pairing code from the other phone')}</label><textarea id="f-code" data-f="code" rows="4" placeholder="PW1.…" required>${esc(d.code || '')}</textarea>`
    : `<p class="hint">${t('Sync uses your own free Supabase project. Follow the 5-minute setup in the README, then paste the two values here.')}</p>
      <label for="f-url">${t('Project URL')}</label><input id="f-url" data-f="url" type="url" value="${esc(d.url || '')}" placeholder="https://xxxx.supabase.co" required autocomplete="off" autocapitalize="off">
      <label for="f-key">${t('Anon / publishable key')}</label><textarea id="f-key" data-f="key" rows="3" required autocapitalize="off">${esc(d.key || '')}</textarea>`}
    <div class="actions"><button type="submit" class="btn primary">${d.busy ? t('Connecting…') : t('Connect')}</button></div>`],
};

function renderSheet() {
  const el = $('#sheet');
  if (!ui.sheet) { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('sheet-open'); return; }
  const [title, body] = SHEETS[ui.sheet.type](ui.sheet.d);
  el.hidden = false;
  document.body.classList.add('sheet-open');
  el.innerHTML = `<div class="backdrop" data-act="close-sheet"></div>
    <form class="panel" role="dialog" aria-modal="true" aria-label="${title}" novalidate>
      <div class="panel-head"><h3>${title}</h3><button type="button" class="x" data-act="close-sheet" aria-label="${t('Close')}">✕</button></div>
      <div class="panel-body">${body}</div></form>`;
}
function openSheet(type, d = {}, focus) {
  ui.sheet = { type, d };
  renderSheet();
  if (focus) setTimeout(() => $('#sheet ' + focus)?.focus(), 60);
}
const closeSheet = () => { ui.sheet = null; renderSheet(); };

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

/* ---------- saving ---------- */
function readTxDraft(d) {
  const amount = parseAmount(d.amountText);
  if (!amount) return toast(t('Enter an amount.')), null;
  if (!d.catId || store.get(d.catId)?.type !== d.type) return toast(t('Pick a category.')), null;
  return amount;
}
async function eraseDevice() {
  await sync.disconnect(); await store.wipe(); await store.setMeta('onboarded', false);
  lock.clearPin(); lock.unlock(); ui.tab = 'home';
}

const SUBMIT = {
  async tx(d) {
    const amount = readTxDraft(d); if (!amount) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return toast(t('Pick a date.'));
    const old = d.id ? store.get(d.id) : null;
    await store.save({ ...(old || {}), id: d.id || 'tx:' + uid(), kind: 'tx', date: d.date, type: d.type, amount, catId: d.catId, note: (d.note || '').trim(), who: d.who || '' });
    localStorage.setItem('pw-who', d.who || '');
    if (ui.tab !== 'year' && d.date.slice(0, 7) <= curMonth()) ui.month = d.date.slice(0, 7);
    closeSheet(); render(); toast(d.id ? t('Saved.') : t(d.type === 'expense' ? 'Expense of {0} added.' : 'Income of {0} added.', fmt(amount)));
  },
  async rec(d) {
    const amount = readTxDraft(d); if (!amount) return;
    const biweekly = !!STEP[d.freq], day = Math.round(Number(d.day));
    if (biweekly && !/^\d{4}-\d{2}-\d{2}$/.test(d.first || '')) return toast(t('Pick a date.'));
    if (!biweekly && !(day >= 1 && day <= 31)) return toast(t('Day must be between 1 and 31.'));
    const old = d.id ? store.get(d.id) : null;
    await store.save({ ...(old || {}), id: d.id || 'rec:' + uid(), kind: 'rec', type: d.type, amount, catId: d.catId, note: (d.note || '').trim(), who: d.who || '',
      freq: biweekly ? d.freq : 'monthly', first: biweekly ? d.first : '', day: biweekly ? (old?.day || Number(d.first.slice(8))) : day,
      active: d.active, start: old?.start || curMonth(), startDate: old?.startDate || today() });
    const n = await runRecurring();
    closeSheet(); render(); toast(n ? t('Recurring payment saved. Payments added up to today: {0}.', n) : t('Recurring payment saved.'));
  },
  async budget(d) {
    const limit = parseAmount(d.amountText) || 0, id = 'budget:' + d.catId;
    if (limit) await store.save({ id, kind: 'budget', catId: d.catId, limit });
    else if (store.get(id)) await store.del(id);
    closeSheet(); render();
  },
  async goal(d) {
    const name = (d.name || '').trim(), target = parseAmount(d.targetText);
    if (!name) return toast(t('Give it a name.'));
    if (!target) return toast(t('Enter a target amount.'));
    const saved = (parseAmount(d.savedText) || 0) + (parseAmount(d.addText) || 0);
    await store.save({ id: d.id || 'goal:' + uid(), kind: 'goal', name, target, saved, deadline: /^\d{4}-\d{2}-\d{2}$/.test(d.deadline || '') ? d.deadline : '', icon: pickedIcon(d, '🎯') });
    closeSheet(); render(); toast(t('Saved.'));
  },
  async cat(d) {
    const name = (d.name || '').trim();
    if (!name) return toast(t('Give it a name.'));
    const id = d.id || catId(name, d.type);
    const clash = (!d.id && store.get(id)) || allCats(d.type).find((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase());
    if (clash) return toast(clash.hidden ? t('A hidden category has this name. Show it again under More → Categories.') : t('That category already exists.'));
    await store.save({ ...(store.get(id) || {}), id, kind: 'cat', name, type: d.type, icon: pickedIcon(d, guessIcon(name, d.type)) });
    closeSheet(); render();
  },
  async people(d) {
    const list = [...new Set([d.p1, d.p2].map((s) => (s || '').trim()).filter(Boolean))];
    await store.save({ id: 'settings', kind: 'settings', people: list });
    closeSheet(); render();
  },
  lang() { closeSheet(); },
  async lock(d) {
    if (!/^\d{4}$/.test(d.pin1 || '')) return toast(t('PIN must be 4 digits.'));
    if (d.pin1 !== d.pin2) return toast(t('The two PINs do not match.'));
    await lock.setPin(d.pin1);
    closeSheet(); render(); toast(t('App lock is on.'));
  },
  async import(d) {
    const fresh = d.txs.filter((x) => !store.raw(x.id));
    const newCats = d.cats.filter((c) => !store.get(c.id));
    await store.saveMany([...newCats, ...fresh]);
    await store.setMeta('onboarded', true);
    await ensureInvestments();
    ui.month = d.to?.slice(0, 7) <= curMonth() ? d.to.slice(0, 7) : curMonth(); ui.tab = 'home';
    closeSheet(); render(); toast(t('Imported transactions: {0}.', num(fresh.length)));
  },
  async confirm(d) { closeSheet(); await d.run(); render(); },
  async sync(d) {
    if (d.busy) return;
    let cfg;
    if (d.mode === 'join') { cfg = sync.parsePairing(d.code || ''); if (!cfg) return toast(t('That pairing code is not valid.')); }
    else {
      let url = (d.url || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), key = (d.key || '').trim();
      // Accept a pasted dashboard link (supabase.com/dashboard/project/<ref>) as well as the project URL.
      const ref = url.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
      if (ref) url = `https://${ref[1]}.supabase.co`;
      else if (/^[a-z0-9]{20}$/i.test(url)) url = `https://${url}.supabase.co`;
      if (!/^https?:\/\/.+/.test(url) || !key) return toast(t('Enter the project URL and key.'));
      cfg = { url, key, household: sync.newHousehold() };
    }
    d.busy = true; renderSheet();
    const ok = await sync.connect(cfg);
    if (!ok) { const msg = sync.status.error; await sync.disconnect(); d.busy = false; renderSheet(); return toast(t('Could not connect: {0}', msg)); }
    await store.setMeta('onboarded', true);
    await runRecurring();
    renderSheet(); render(); toast(t('Sync is on.'));
  },
};

/* ---------- files ---------- */
function pickFile(accept) {
  return new Promise((res) => {
    const f = $('#file'); f.value = ''; f.accept = accept;
    f.onchange = () => res(f.files[0] || null);
    f.click();
  });
}
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (/iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- actions ---------- */
const ACTIONS = {
  tab(el) { ui.tab = el.dataset.v; ui.trendSel = null; if (ui.tab !== 'list') { ui.filterCat = null; ui.q = ''; } render(); scrollTo(0, 0); },
  month(el) { const m = addMonths(ui.month, Number(el.dataset.v)); if (m <= curMonth()) { ui.month = m; ui.trendSel = null; render(); } },
  'month-now'() { ui.month = curMonth(); ui.trendSel = null; render(); },
  'open-year'() { ui.year = ui.month.slice(0, 4); ui.tab = 'year'; ui.trendSel = null; render(); scrollTo(0, 0); },
  year(el) { const y = String(Number(ui.year) + Number(el.dataset.v)); if (y <= curMonth().slice(0, 4) && y >= firstYear()) { ui.year = y; ui.trendSel = null; render(); } },
  'year-now'() { ui.year = curMonth().slice(0, 4); ui.trendSel = null; render(); },
  trend(el) { ui.trendSel = el.dataset.v; render(); },
  'filter-cat'(el) { ui.filterCat = el.dataset.id; ui.q = ''; ui.tab = 'list'; render(); scrollTo(0, 0); },
  'clear-filter'() { ui.filterCat = null; render(); },
  'new-tx'() {
    if (!cats().length) return toast(t('Add a category first (More → Categories).'));
    const date = ui.month === curMonth() || ui.tab === 'year' ? today() : `${ui.month}-01`;
    const who = people().includes(localStorage.getItem('pw-who')) ? localStorage.getItem('pw-who') : '';
    openSheet('tx', { type: 'expense', date, who, catId: ui.tab === 'list' && store.get(ui.filterCat)?.type === 'expense' ? ui.filterCat : null }, '[data-f=amountText]');
  },
  'edit-tx'(el) { const x = store.get(el.dataset.id); if (x) openSheet('tx', { ...x, amountText: fmtInput(x.amount) }); },
  'new-rec'() { if (!cats().length) return toast(t('Add a category first (More → Categories).')); openSheet('rec', { type: 'expense', freq: 'monthly', day: new Date().getDate(), first: today(), active: true }, '[data-f=amountText]'); },
  'edit-rec'(el) { const r = store.get(el.dataset.id); if (r) openSheet('rec', { ...r, freq: isBiweekly(r) ? r.freq : 'monthly', first: r.first || today(), amountText: fmtInput(r.amount) }); },
  'edit-budget'(el) { const b = store.get('budget:' + el.dataset.id); openSheet('budget', { catId: el.dataset.id, amountText: b ? fmtInput(b.limit) : '' }, '[data-f=amountText]'); },
  'new-goal'() { openSheet('goal', { icon: '🎯' }, '#f-name'); },
  'edit-goal'(el) { const g = store.get(el.dataset.id); if (g) openSheet('goal', { ...g, targetText: fmtInput(g.target), savedText: fmtInput(g.saved) }, '#f-add'); },
  'new-cat'() { openSheet('cat', { type: 'expense', icon: '🏷️' }, '#f-name'); },
  'edit-cat'(el) { const c = store.get(el.dataset.id); if (c) openSheet('cat', { ...c }); },
  'open-people'() { const p = people(); openSheet('people', { p1: p[0], p2: p[1] }); },
  'open-sync'() { openSheet('sync', { mode: 'join' }); },
  'open-lang'() { openSheet('lang'); },
  'toggle-lang'() { setLang(lang() === 'uk' ? 'en' : 'uk'); render(); },
  'open-lock'() { openSheet('lock', {}, '#f-pin1'); },
  'lock-off'() { lock.clearPin(); closeSheet(); render(); toast(t('App lock is off.')); },
  async 'cat-hide'(el) {
    const c = store.get(ui.sheet.d.id), hide = el.dataset.v === '1';
    if (!c) return;
    await store.save({ ...c, hidden: hide });
    if (hide && store.get('budget:' + c.id)) await store.del('budget:' + c.id);
    closeSheet(); render(); toast(hide ? t('Category hidden.') : t('Category is back.'));
  },
  'close-sheet': closeSheet,
  set(el) {
    const d = ui.sheet.d, f = el.dataset.f; let v = el.dataset.v;
    if (f === 'lang') { setLang(v); render(); return renderSheet(); }
    if (f === 'icon') d.iconText = '';
    if (f === 'active') v = v === '1';
    d[f] = v;
    if (f === 'type' && d.catId && store.get(d.catId)?.type !== v) d.catId = null;
    const scroll = $('#sheet .panel-body')?.scrollTop;
    renderSheet();
    if (scroll) $('#sheet .panel-body').scrollTop = scroll;
  },
  async 'sheet-delete'() {
    const { type, d } = ui.sheet;
    if (type === 'cat') {
      const used = catUses(d.id);
      if (used) return toast(t('In use by {0} entries, so it cannot be deleted.', num(used)));
      if (store.get('budget:' + d.id)) await store.del('budget:' + d.id);
    }
    await store.del(d.id);
    closeSheet(); render(); toast(t('Deleted.'));
  },
  async 'start-fresh'() {
    await store.saveMany(DEFAULT_CATS.map(([name, type, icon]) => ({ id: catId(name, type), kind: 'cat', name: t(name), type, icon })));
    await store.setMeta('onboarded', true); render();
  },
  async 'import-csv'() {
    const file = await pickFile('.csv,text/csv,text/comma-separated-values');
    if (!file) return;
    try {
      const d = mapMonefy(await file.text());
      if (!d.txs.length) return toast(t('No transactions found in that file.'));
      d.dupes = d.txs.filter((x) => store.raw(x.id)).length;
      openSheet('import', d);
    } catch (e) { toast(e.message); }
  },
  async 'export-backup'() {
    const records = store.everything().map(({ dirty, ...r }) => r);
    await saveFile(`pennywise-backup-${today()}.json`, JSON.stringify({ app: 'pennywise', version: 1, exportedAt: new Date().toISOString(), records }), 'application/json');
  },
  async 'import-backup'() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (j.app !== 'pennywise' || !Array.isArray(j.records)) throw 0;
      const ok = j.records.filter((r) => r && typeof r.id === 'string' && typeof r.kind === 'string' && Number.isFinite(r.updatedAt));
      const n = await store.merge(ok, { fromCloud: false });
      await store.setMeta('onboarded', true);
      render(); toast(n ? t('Restored records: {0}.', num(n)) : t('Everything in that backup is already here.'));
    } catch { toast(t('That file is not a Pennywise backup.')); }
  },
  async 'export-csv'() { await saveFile(`pennywise-${today()}.csv`, toCSV(txs(), (id) => catOf(id).name), 'text/csv'); },
  erase() {
    openSheet('confirm', { title: t('Erase data on this phone?'), ok: t('Erase'),
      text: `${t('This removes all transactions ({0}) from this phone and turns sync off here.', num(txs().length))} ${sync.enabled() ? t('The other phone and the cloud copy are not affected.') : t('Save a backup first if you may want them back.')}`,
      run: eraseDevice });
  },
  async 'sync-now'() { await sync.syncNow(); renderSheet(); render(); },
  async 'copy-code'() { try { await navigator.clipboard.writeText(sync.pairingCode()); toast(t('Pairing code copied.')); } catch { $('#f-code').select(); toast(t('Select and copy the code.')); } },
  async 'sync-off'() { await sync.disconnect(); closeSheet(); render(); toast(t('Sync turned off on this phone.')); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  ACTIONS[el.dataset.act]?.(el);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.q = e.target.value; render(); return; }
  const f = e.target.dataset?.f;
  if (f && ui.sheet) ui.sheet.d[f] = e.target.value;
  if (f === 'iconText' && ui.sheet) { const now = $('#sheet .icon-now'); if (now) now.textContent = pickedIcon(ui.sheet.d, '🏷️'); $('#sheet .icon-grid .on')?.classList.remove('on'); }
});
document.addEventListener('submit', (e) => { e.preventDefault(); if (ui.sheet) SUBMIT[ui.sheet.type](ui.sheet.d); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });

/* ---------- boot ---------- */
(async () => {
  await store.init();
  lock.start(() => openSheet('confirm', { title: t('Forgot your PIN?'), ok: t('Erase and reset'),
    text: t('The only way back in is to erase the data on this phone. With sync on, you can then rejoin with the pairing code from the other phone.'), run: eraseDevice }));
  await ensureInvestments();
  await runRecurring();
  store.onChange((src) => { if (src === 'remote') { runRecurring(); render(); } });
  sync.onStatus(() => { if (!store.isEmpty() || store.getMeta('onboarded')) renderChrome(); if (ui.tab === 'more') render(); if (ui.sheet?.type === 'sync' && !ui.sheet.d.busy) renderSheet(); });
  sync.start();
  render();
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await runRecurring(); if (!ui.sheet) render(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // When an updated version takes over, reload once so the new screens appear (not while a form is open).
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !ui.sheet) location.reload(); });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  }
})();
