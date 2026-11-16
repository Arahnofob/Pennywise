// Pennywise UI: state, views, sheets and event handling.
import * as store from './store.js';
import * as sync from './sync.js';
import { mapMonefy, toCSV, catId, guessIcon } from './csv.js';
import { categoryBars, trendChart } from './charts.js';
import { uid, esc, fmt, fmtInput, parseAmount, today, curMonth, addMonths, daysInMonth, monthLabel, dayLabel } from './util.js';

const $ = (s) => document.querySelector(s);
const ui = { tab: 'home', month: curMonth(), q: '', filterCat: null, trendSel: null, sheet: null };

const DEFAULT_CATS = [
  ['Groceries', 'expense', '🛒'], ['Eating out', 'expense', '☕'], ['Home', 'expense', '🏠'], ['Bills', 'expense', '🧾'],
  ['Car', 'expense', '🚗'], ['Transport', 'expense', '🚌'], ['Health', 'expense', '💊'], ['Clothes', 'expense', '👕'],
  ['Fun', 'expense', '🎬'], ['Gifts', 'expense', '🎁'], ['Phone', 'expense', '📱'], ['Pets', 'expense', '🐾'],
  ['Salary', 'income', '💼'], ['Other income', 'income', '💰'],
];
const ICON_CHOICES = '🛒 ☕ 🍽️ 🏠 🧾 💡 🚗 ⛽ 🚌 🚕 ✈️ 💊 🧴 👕 🎬 🎮 🎁 📱 🌐 🐾 🏋️ 🎓 🧸 🛠️ 📦 💼 💰 🏦 🐖 📈 🏷️'.split(' ');

/* ---------- data helpers ---------- */
const cats = (type) => store.all('cat').filter((c) => !type || c.type === type).sort((a, b) => a.name.localeCompare(b.name));
const catOf = (id) => store.get(id) || { name: 'Uncategorized', icon: '❓' };
const people = () => store.get('settings')?.people || [];
const txs = () => store.all('tx');
const sum = (list, type) => list.reduce((s, t) => s + (t.type === type ? t.amount : 0), 0);
const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0);

// Creates this month's (and any missed months') transactions for recurring payments.
// The id is derived from the rule and the month, so two phones never create duplicates.
async function runRecurring() {
  const out = [], now = today(), cm = curMonth();
  for (const r of store.all('rec')) {
    if (!r.active) continue;
    for (let m = r.start; m <= cm; m = addMonths(m, 1)) {
      const date = `${m}-${String(Math.min(r.day, daysInMonth(m))).padStart(2, '0')}`;
      const id = `tx:${r.id}:${m}`;
      if (date > now || date < r.startDate || store.raw(id)) continue;
      out.push({ id, kind: 'tx', date, type: r.type, amount: r.amount, catId: r.catId, note: r.note, who: r.who || '', recId: r.id });
    }
  }
  if (out.length) await store.saveMany(out);
}

/* ---------- chrome ---------- */
const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TABS = [
  ['home', 'Overview', svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')],
  ['list', 'Transactions', svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>')],
  ['add'],
  ['budgets', 'Budgets', svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>')],
  ['more', 'More', svg('<path d="M5 12h.01M12 12h.01M19 12h.01"/>')],
];

function renderChrome() {
  const showMonth = ui.tab !== 'more';
  const st = sync.status;
  $('#top').innerHTML = `
    <div class="brand"><img src="icons/icon.svg" alt="" width="26" height="26"><span>Pennywise</span>
      ${sync.enabled() ? `<button class="sync-pill ${st.state}" data-act="open-sync" aria-label="Sync status">${st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? '⚠ Sync issue' : '✓ Synced'}</button>` : ''}
    </div>
    ${showMonth ? `<div class="month">
      <button data-act="month" data-v="-1" aria-label="Previous month">‹</button>
      <button class="month-name" data-act="month-now">${monthLabel(ui.month)}</button>
      <button data-act="month" data-v="1" aria-label="Next month" ${ui.month >= curMonth() ? 'disabled' : ''}>›</button>
    </div>` : ''}`;
  $('#tabs').innerHTML = TABS.map(([id, label, glyph]) => id === 'add'
    ? `<button class="fab" data-act="new-tx" aria-label="Add transaction">+</button>`
    : `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-v="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>${glyph}${label}</button>`).join('');
}

/* ---------- views ---------- */
function txRow(t) {
  const c = catOf(t.catId);
  const sub = [t.note ? c.name : '', t.who, t.recId ? 'recurring' : ''].filter(Boolean).join(' · ');
  return `<button class="tx" data-act="edit-tx" data-id="${esc(t.id)}">
    <span class="ico" aria-hidden="true">${esc(c.icon)}</span>
    <span class="tx-main"><span class="tx-title">${esc(t.note || c.name)}</span>${sub ? `<span class="tx-sub">${esc(sub)}</span>` : ''}</span>
    <span class="amt ${t.type}">${t.type === 'expense' ? '−' : '+'}${fmt(t.amount)}</span>
  </button>`;
}

function txGroups(list) {
  let html = '', day = null, buf = [];
  const flush = () => {
    if (!buf.length) return;
    const net = sum(buf, 'income') - sum(buf, 'expense');
    html += `<div class="day"><span>${dayLabel(day)}</span><span>${net < 0 ? '−' : '+'}${fmt(Math.abs(net))}</span></div><div class="card list">${buf.map(txRow).join('')}</div>`;
    buf = [];
  };
  for (const t of list) { if (t.date !== day) { flush(); day = t.date; } buf.push(t); }
  flush();
  return html;
}

function spendByCat(list, type = 'expense') {
  const m = new Map();
  for (const t of list) if (t.type === type) m.set(t.catId, (m.get(t.catId) || 0) + t.amount);
  return [...m].map(([id, amount]) => ({ id, amount, ...catOf(id) })).map((c) => ({ id: c.id, amount: c.amount, name: c.name, icon: c.icon })).sort((a, b) => b.amount - a.amount);
}

function viewHome() {
  const all = txs(), list = all.filter((t) => t.date.startsWith(ui.month));
  const inc = sum(list, 'income'), exp = sum(list, 'expense'), bal = inc - exp;
  const spend = spendByCat(list);
  const months = [];
  for (let i = 5; i >= 0; i--) months.push({ month: addMonths(ui.month, -i), income: 0, expense: 0 });
  const idx = new Map(months.map((m) => [m.month, m]));
  for (const t of all) { const m = idx.get(t.date.slice(0, 7)); if (m) m[t.type] += t.amount; }

  const budgets = store.all('budget');
  let budgetStrip = '';
  if (budgets.length) {
    const limit = budgets.reduce((s, b) => s + b.limit, 0);
    const used = budgets.reduce((s, b) => s + (spend.find((c) => c.id === b.catId)?.amount || 0), 0);
    const left = limit - used;
    budgetStrip = `<button class="card strip" data-act="tab" data-v="budgets">
      <span><b>${left >= 0 ? fmt(left) + ' left' : '⚠ ' + fmt(-left) + ' over'}</b> of ${fmt(limit)} budgeted</span>
      <span class="track"><span class="fill ${left < 0 ? 'over' : ''}" style="width:${Math.min((used / (limit || 1)) * 100, 100)}%"></span></span>
    </button>`;
  }
  const ppl = people();
  let byPerson = '';
  if (ppl.length && list.some((t) => t.who && t.type === 'expense')) {
    const rows = [...ppl, ''].map((p) => ({ name: p || 'Shared / not set', amount: list.reduce((s, t) => s + (t.type === 'expense' && (t.who || '') === p ? t.amount : 0), 0) })).filter((r) => r.amount);
    const max = Math.max(...rows.map((r) => r.amount));
    byPerson = `<h2>Spending by person</h2><div class="card pad"><div class="bars">${rows.map((r) => `
      <div class="bar-row static"><span class="bar-main"><span class="bar-head"><span class="bar-name">${esc(r.name)}</span><span class="bar-val">${fmt(r.amount)}</span></span>
      <span class="track"><span class="fill" style="width:${(r.amount / max) * 100}%"></span></span></span></div>`).join('')}</div></div>`;
  }

  return `
    <section class="hero">
      <div class="hero-label">Balance for ${monthLabel(ui.month)}</div>
      <div class="hero-num">${bal < 0 ? '−' : ''}${fmt(Math.abs(bal))}</div>
      <div class="hero-pair">
        <div><span>Income</span><b>${fmt(inc)}</b></div>
        <div><span>Expenses</span><b>${fmt(exp)}</b></div>
      </div>
    </section>
    ${budgetStrip}
    <h2>Spending by category</h2>
    ${spend.length ? `<div class="card pad">${categoryBars(spend)}</div>` : `<div class="card empty">No expenses in ${monthLabel(ui.month)} yet.<br>Tap <b>+</b> to add one.</div>`}
    ${byPerson}
    <h2>Last 6 months</h2>
    <div class="card pad">${trendChart(months, ui.trendSel && idx.has(ui.trendSel) ? ui.trendSel : ui.month)}</div>
    ${list.length ? `<h2>Latest</h2><div class="card list">${[...list].sort(byNewest).slice(0, 5).map(txRow).join('')}</div>
      <button class="link" data-act="tab" data-v="list">See all ${list.length} transactions</button>` : ''}`;
}

function viewList() {
  const q = ui.q.trim().toLowerCase();
  let list = txs();
  if (!q) list = list.filter((t) => t.date.startsWith(ui.month));
  if (ui.filterCat) list = list.filter((t) => t.catId === ui.filterCat);
  if (q) list = list.filter((t) => `${t.note} ${catOf(t.catId).name} ${t.who || ''} ${(t.amount / 100).toFixed(2)}`.toLowerCase().includes(q));
  list.sort(byNewest);
  const shown = list.slice(0, 300);
  const fc = ui.filterCat && catOf(ui.filterCat);
  return `
    <div class="search"><input type="search" id="q" placeholder="Search all transactions" value="${esc(ui.q)}" aria-label="Search transactions" autocomplete="off"></div>
    <div id="list-body">
    ${fc ? `<button class="chip on" data-act="clear-filter">${esc(fc.icon)} ${esc(fc.name)} ✕</button>` : ''}
    <div class="totals"><span>${list.length} ${list.length === 1 ? 'transaction' : 'transactions'}${q ? ' in all months' : ''}</span>
      <span>+${fmt(sum(list, 'income'))} &nbsp; −${fmt(sum(list, 'expense'))}</span></div>
    ${shown.length ? txGroups(shown) : `<div class="card empty">${q || fc ? 'Nothing matches.' : `No transactions in ${monthLabel(ui.month)}.`}</div>`}
    ${list.length > shown.length ? `<p class="hint">Showing the newest 300. Refine the search to see older ones.</p>` : ''}
    </div>`;
}

function viewBudgets() {
  const list = txs().filter((t) => t.date.startsWith(ui.month));
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
        <span class="bar-head"><span class="bar-name">${esc(c.name)}</span><span class="bar-val">${fmt(used)}${limit ? ` <small>of ${fmt(limit)}</small>` : ''}</span></span>
        ${limit ? `<span class="track"><span class="fill ${left < 0 ? 'over' : ''}" style="width:${Math.min((used / limit) * 100, 100)}%"></span></span>
        <span class="budget-note ${left < 0 ? 'over' : ''}">${left < 0 ? `⚠ Over by ${fmt(-left)}` : `${fmt(left)} left`}</span>` : `<span class="budget-note">No budget · tap to set</span>`}
      </span></button>`;
  };
  if (!rows.length) return `<div class="card empty">Add a category first, then set a monthly limit for it here.</div>`;
  return `
    ${withB.length ? `<h2>Budgets for ${monthLabel(ui.month)}</h2><div class="card list">${withB.map(row).join('')}</div>` : `<div class="card empty">No budgets yet. Tap a category below to set a monthly limit.</div>`}
    ${without.length ? `<h2>Without a budget</h2><div class="card list">${without.map(row).join('')}</div>` : ''}`;
}

function viewMore() {
  const recs = store.all('rec').sort((a, b) => a.day - b.day);
  const st = sync.status, on = sync.enabled();
  const item = (act, icon, title, sub, attrs = '') => `<button class="tx" data-act="${act}" ${attrs}><span class="ico" aria-hidden="true">${icon}</span>
    <span class="tx-main"><span class="tx-title">${title}</span>${sub ? `<span class="tx-sub">${sub}</span>` : ''}</span><span class="chev">›</span></button>`;
  return `
    <h2>Recurring payments</h2>
    <div class="card list">
      ${recs.map((r) => { const c = catOf(r.catId); return `<button class="tx" data-act="edit-rec" data-id="${esc(r.id)}"><span class="ico" aria-hidden="true">${esc(c.icon)}</span>
        <span class="tx-main"><span class="tx-title">${esc(r.note || c.name)}</span><span class="tx-sub">Day ${r.day} of every month${r.active ? '' : ' · paused'}</span></span>
        <span class="amt">${r.type === 'expense' ? '−' : '+'}${fmt(r.amount)}</span></button>`; }).join('')}
      ${item('new-rec', '＋', 'Add recurring payment', 'Rent, subscriptions, salary…')}
    </div>
    <h2>Categories</h2>
    <div class="card pad"><div class="cat-grid">
      ${cats().map((c) => `<button class="cat" data-act="edit-cat" data-id="${esc(c.id)}"><span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}
      <button class="cat add" data-act="new-cat"><span aria-hidden="true">＋</span>New</button>
    </div></div>
    <h2>Household</h2>
    <div class="card list">
      ${item('open-people', '👥', 'People', people().length ? esc(people().join(', ')) : 'Add your names to track who paid')}
      ${item('open-sync', '☁️', 'Sync between phones', on ? (st.state === 'error' ? '⚠ ' + esc(st.error) : st.state === 'syncing' ? 'Syncing…' : 'On' + (st.lastSync ? ' · last synced ' + new Date(st.lastSync).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '')) : 'Off · data stays on this phone')}
    </div>
    <h2>Your data</h2>
    <div class="card list">
      ${item('import-csv', '📥', 'Import from Monefy', 'Pick the CSV file exported from Monefy')}
      ${item('export-backup', '💾', 'Save a backup', 'Everything in one file you can restore later')}
      ${item('import-backup', '♻️', 'Restore a backup', 'Merges a backup file into this phone')}
      ${item('export-csv', '📄', 'Export as CSV', 'Open your transactions in a spreadsheet')}
      ${item('erase', '🗑️', 'Erase data on this phone', '')}
    </div>
    <p class="hint">Pennywise keeps your data on this phone. ${txs().length.toLocaleString('en-CA')} transactions stored.</p>`;
}

function viewWelcome() {
  return `<section class="welcome">
    <img src="icons/icon.svg" alt="" width="88" height="88">
    <h1>Welcome to Pennywise</h1>
    <p>A private money tracker for the two of you. Everything is stored on this phone.</p>
    <button class="btn primary" data-act="import-csv">Import my Monefy history</button>
    <button class="btn" data-act="start-fresh">Start fresh</button>
    <button class="btn ghost" data-act="open-sync">Join my partner's Pennywise</button>
  </section>`;
}

function render() {
  const welcome = store.isEmpty() && !store.getMeta('onboarded');
  document.body.classList.toggle('welcome-mode', welcome);
  if (welcome) { $('#top').innerHTML = ''; $('#tabs').innerHTML = ''; $('#view').innerHTML = viewWelcome(); return; }
  renderChrome();
  const keep = ui.tab === 'list' && document.activeElement?.id === 'q';
  if (keep) { $('#list-body').outerHTML = viewList().match(/<div id="list-body">[\s\S]*$/)[0]; return; }
  $('#view').innerHTML = { home: viewHome, list: viewList, budgets: viewBudgets, more: viewMore }[ui.tab]();
}

/* ---------- sheets ---------- */
const seg = (f, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-act="set" data-f="${f}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
const catPicker = (d) => {
  const list = cats(d.type);
  return list.length ? `<div class="cat-grid pick">${list.map((c) => `<button type="button" class="cat ${d.catId === c.id ? 'on' : ''}" data-act="set" data-f="catId" data-v="${esc(c.id)}" aria-pressed="${d.catId === c.id}"><span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}</div>`
    : `<p class="hint">No ${d.type} categories yet. Add one under More → Categories.</p>`;
};
const whoPicker = (d) => people().length ? `<label>Who</label>${seg('who', d.who || '', [['', 'Shared'], ...people().map((p) => [esc(p), esc(p)])])}` : '';
const amountField = (d) => `<div class="amount"><span>$</span><input data-f="amountText" inputmode="decimal" placeholder="0.00" value="${esc(d.amountText || '')}" aria-label="Amount in Canadian dollars" autocomplete="off"></div>`;
const actions = (d, label = 'Save') => `<div class="actions">${d.id ? `<button type="button" class="btn danger" data-act="sheet-delete">Delete</button>` : ''}<button type="submit" class="btn primary">${label}</button></div>`;

const SHEETS = {
  tx: (d) => [d.id ? 'Edit transaction' : 'New transaction', `
    ${seg('type', d.type, [['expense', 'Expense'], ['income', 'Income']])}
    ${amountField(d)}
    <label>Category</label>${catPicker(d)}
    <div class="row2"><div><label for="f-date">Date</label><input id="f-date" type="date" data-f="date" value="${esc(d.date)}" max="2100-12-31" required></div>
    <div><label for="f-note">Note</label><input id="f-note" data-f="note" value="${esc(d.note || '')}" placeholder="Optional" autocomplete="off" maxlength="120"></div></div>
    ${whoPicker(d)}${actions(d)}`],
  rec: (d) => [d.id ? 'Edit recurring payment' : 'New recurring payment', `
    ${seg('type', d.type, [['expense', 'Expense'], ['income', 'Income']])}
    ${amountField(d)}
    <label>Category</label>${catPicker(d)}
    <div class="row2"><div><label for="f-day">Day of month</label><input id="f-day" type="number" min="1" max="31" data-f="day" value="${esc(d.day)}" inputmode="numeric" required></div>
    <div><label for="f-note">Name</label><input id="f-note" data-f="note" value="${esc(d.note || '')}" placeholder="e.g. Rent" autocomplete="off" maxlength="120"></div></div>
    ${whoPicker(d)}
    <label>Status</label>${seg('active', d.active ? '1' : '0', [['1', 'Active'], ['0', 'Paused']])}
    <p class="hint">Added automatically each month, starting the next time that day comes around.</p>${actions(d)}`],
  budget: (d) => [`Budget for ${esc(catOf(d.catId).name)}`, `
    <label>Monthly limit</label>${amountField(d)}
    <p class="hint">Leave empty and save to remove the budget.</p>${actions({}, 'Save')}`],
  cat: (d) => [d.id ? 'Edit category' : 'New category', `
    ${d.id ? '' : seg('type', d.type, [['expense', 'Expense'], ['income', 'Income']])}
    <label for="f-name">Name</label><input id="f-name" data-f="name" value="${esc(d.name || '')}" required maxlength="40" autocomplete="off">
    <label>Icon</label><div class="icon-grid">${ICON_CHOICES.map((i) => `<button type="button" class="${d.icon === i ? 'on' : ''}" data-act="set" data-f="icon" data-v="${i}" aria-pressed="${d.icon === i}">${i}</button>`).join('')}</div>
    ${actions(d)}`],
  people: (d) => ['People', `
    <label for="f-p1">First person</label><input id="f-p1" data-f="p1" value="${esc(d.p1 || '')}" maxlength="24" placeholder="Name" autocomplete="off">
    <label for="f-p2">Second person</label><input id="f-p2" data-f="p2" value="${esc(d.p2 || '')}" maxlength="24" placeholder="Name" autocomplete="off">
    <p class="hint">With names set, every transaction can be marked with who paid. Use the same names on both phones.</p>${actions({})}`],
  import: (d) => ['Import from Monefy', `
    <div class="summary"><div><b>${d.txs.length.toLocaleString('en-CA')}</b> transactions</div><div><b>${d.cats.length}</b> categories</div></div>
    <p>From ${dayLabel(d.from)} to ${dayLabel(d.to)}.</p>
    ${d.dupes ? `<p class="hint">${d.dupes.toLocaleString('en-CA')} of them are already in Pennywise and will be skipped.</p>` : ''}
    ${d.skipped ? `<p class="hint">${d.skipped} rows could not be read and will be skipped.</p>` : ''}
    <div class="actions"><button type="submit" class="btn primary">${d.txs.length - d.dupes ? `Import ${(d.txs.length - d.dupes).toLocaleString('en-CA')} transactions` : 'Nothing new to import'}</button></div>`],
  confirm: (d) => [d.title, `<p>${d.text}</p><div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button type="submit" class="btn danger">${d.ok}</button></div>`],
  sync: (d) => sync.enabled() ? ['Sync between phones', `
    <p class="status ${sync.status.state}">${sync.status.state === 'error' ? '⚠ ' + esc(sync.status.error) : sync.status.state === 'syncing' ? 'Syncing…' : '✓ Sync is on. Changes appear on the other phone within a minute.'}</p>
    <label for="f-code">Pairing code for the other phone</label>
    <textarea id="f-code" readonly rows="4">${esc(sync.pairingCode())}</textarea>
    <p class="hint">On the other phone open More → Sync between phones → paste this code. Keep it private: anyone with the code can see your data.</p>
    <div class="actions"><button type="button" class="btn danger" data-act="sync-off">Turn off</button><button type="button" class="btn" data-act="copy-code">Copy code</button><button type="button" class="btn primary" data-act="sync-now">Sync now</button></div>`]
    : ['Sync between phones', `
    ${seg('mode', d.mode, [['join', 'I have a pairing code'], ['new', 'Set up first phone']])}
    ${d.mode === 'join' ? `<label for="f-code">Pairing code from the other phone</label><textarea id="f-code" data-f="code" rows="4" placeholder="PW1.…" required>${esc(d.code || '')}</textarea>`
    : `<p class="hint">Sync uses your own free Supabase project. Follow the 5-minute setup in the README, then paste the two values here.</p>
      <label for="f-url">Project URL</label><input id="f-url" data-f="url" type="url" value="${esc(d.url || '')}" placeholder="https://xxxx.supabase.co" required autocomplete="off" autocapitalize="off">
      <label for="f-key">Anon / publishable key</label><textarea id="f-key" data-f="key" rows="3" required autocapitalize="off">${esc(d.key || '')}</textarea>`}
    <div class="actions"><button type="submit" class="btn primary">${d.busy ? 'Connecting…' : 'Connect'}</button></div>`],
};

function renderSheet() {
  const el = $('#sheet');
  if (!ui.sheet) { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('sheet-open'); return; }
  const [title, body] = SHEETS[ui.sheet.type](ui.sheet.d);
  el.hidden = false;
  document.body.classList.add('sheet-open');
  el.innerHTML = `<div class="backdrop" data-act="close-sheet"></div>
    <form class="panel" role="dialog" aria-modal="true" aria-label="${title}" novalidate>
      <div class="panel-head"><h3>${title}</h3><button type="button" class="x" data-act="close-sheet" aria-label="Close">✕</button></div>
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
  if (!amount) return toast('Enter an amount.'), null;
  if (!d.catId || store.get(d.catId)?.type !== d.type) return toast('Pick a category.'), null;
  return amount;
}

const SUBMIT = {
  async tx(d) {
    const amount = readTxDraft(d); if (!amount) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return toast('Pick a date.');
    const old = d.id ? store.get(d.id) : null;
    await store.save({ ...(old || {}), id: d.id || 'tx:' + uid(), kind: 'tx', date: d.date, type: d.type, amount, catId: d.catId, note: (d.note || '').trim(), who: d.who || '' });
    localStorage.setItem('pw-who', d.who || '');
    ui.month = d.date.slice(0, 7) > curMonth() ? ui.month : d.date.slice(0, 7);
    closeSheet(); render(); toast(d.id ? 'Saved.' : `${d.type === 'expense' ? 'Expense' : 'Income'} of ${fmt(amount)} added.`);
  },
  async rec(d) {
    const amount = readTxDraft(d); if (!amount) return;
    const day = Math.round(Number(d.day));
    if (!(day >= 1 && day <= 31)) return toast('Day must be between 1 and 31.');
    const old = d.id ? store.get(d.id) : null;
    await store.save({ ...(old || {}), id: d.id || 'rec:' + uid(), kind: 'rec', type: d.type, amount, catId: d.catId, note: (d.note || '').trim(), who: d.who || '', day,
      active: d.active, start: old?.start || curMonth(), startDate: old?.startDate || today() });
    await runRecurring();
    closeSheet(); render(); toast('Recurring payment saved.');
  },
  async budget(d) {
    const limit = parseAmount(d.amountText) || 0, id = 'budget:' + d.catId;
    if (limit) await store.save({ id, kind: 'budget', catId: d.catId, limit });
    else if (store.get(id)) await store.del(id);
    closeSheet(); render();
  },
  async cat(d) {
    const name = (d.name || '').trim();
    if (!name) return toast('Give the category a name.');
    const id = d.id || catId(name, d.type);
    if (!d.id && store.get(id)) return toast('That category already exists.');
    if (cats(d.type).some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists.');
    await store.save({ id, kind: 'cat', name, type: d.type, icon: d.icon || guessIcon(name, d.type) });
    closeSheet(); render();
  },
  async people(d) {
    const list = [...new Set([d.p1, d.p2].map((s) => (s || '').trim()).filter(Boolean))];
    await store.save({ id: 'settings', kind: 'settings', people: list });
    closeSheet(); render();
  },
  async import(d) {
    const fresh = d.txs.filter((t) => !store.raw(t.id));
    const newCats = d.cats.filter((c) => !store.get(c.id));
    await store.saveMany([...newCats, ...fresh]);
    await store.setMeta('onboarded', true);
    ui.month = d.to?.slice(0, 7) <= curMonth() ? d.to.slice(0, 7) : curMonth(); ui.tab = 'home';
    closeSheet(); render(); toast(`Imported ${fresh.length.toLocaleString('en-CA')} transactions.`);
  },
  async confirm(d) { closeSheet(); await d.run(); render(); },
  async sync(d) {
    if (d.busy) return;
    let cfg;
    if (d.mode === 'join') { cfg = sync.parsePairing(d.code || ''); if (!cfg) return toast('That pairing code is not valid.'); }
    else {
      const url = (d.url || '').trim(), key = (d.key || '').trim();
      if (!/^https?:\/\/.+/.test(url) || !key) return toast('Enter the project URL and key.');
      cfg = { url, key, household: sync.newHousehold() };
    }
    d.busy = true; renderSheet();
    const ok = await sync.connect(cfg);
    if (!ok) { const msg = sync.status.error; await sync.disconnect(); d.busy = false; renderSheet(); return toast('Could not connect: ' + msg); }
    await store.setMeta('onboarded', true);
    await runRecurring();
    renderSheet(); render(); toast('Sync is on.');
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
  tab(el) { ui.tab = el.dataset.v; if (ui.tab !== 'list') { ui.filterCat = null; ui.q = ''; } render(); scrollTo(0, 0); },
  month(el) { const m = addMonths(ui.month, Number(el.dataset.v)); if (m <= curMonth()) { ui.month = m; ui.trendSel = null; render(); } },
  'month-now'() { ui.month = curMonth(); ui.trendSel = null; render(); },
  trend(el) { ui.trendSel = el.dataset.v; render(); },
  'filter-cat'(el) { ui.filterCat = el.dataset.id; ui.q = ''; ui.tab = 'list'; render(); scrollTo(0, 0); },
  'clear-filter'() { ui.filterCat = null; render(); },
  'new-tx'() {
    if (!cats().length) return toast('Add a category first (More → Categories).');
    const date = ui.month === curMonth() ? today() : `${ui.month}-01`;
    const who = people().includes(localStorage.getItem('pw-who')) ? localStorage.getItem('pw-who') : '';
    openSheet('tx', { type: 'expense', date, who, catId: ui.tab === 'list' && store.get(ui.filterCat)?.type === 'expense' ? ui.filterCat : null }, '[data-f=amountText]');
  },
  'edit-tx'(el) { const t = store.get(el.dataset.id); if (t) openSheet('tx', { ...t, amountText: fmtInput(t.amount) }); },
  'new-rec'() { if (!cats().length) return toast('Add a category first.'); openSheet('rec', { type: 'expense', day: new Date().getDate(), active: true }, '[data-f=amountText]'); },
  'edit-rec'(el) { const r = store.get(el.dataset.id); if (r) openSheet('rec', { ...r, amountText: fmtInput(r.amount) }); },
  'edit-budget'(el) { const b = store.get('budget:' + el.dataset.id); openSheet('budget', { catId: el.dataset.id, amountText: b ? fmtInput(b.limit) : '' }, '[data-f=amountText]'); },
  'new-cat'() { openSheet('cat', { type: 'expense', icon: '🏷️' }, '#f-name'); },
  'edit-cat'(el) { const c = store.get(el.dataset.id); if (c) openSheet('cat', { ...c }); },
  'open-people'() { const p = people(); openSheet('people', { p1: p[0], p2: p[1] }); },
  'open-sync'() { openSheet('sync', { mode: 'join' }); },
  'close-sheet': closeSheet,
  set(el) {
    const d = ui.sheet.d, f = el.dataset.f; let v = el.dataset.v;
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
      const used = txs().filter((t) => t.catId === d.id).length + store.all('rec').filter((r) => r.catId === d.id).length;
      if (used) return toast(`${used} ${used === 1 ? 'entry uses' : 'entries use'} this category, so it cannot be deleted.`);
      if (store.get('budget:' + d.id)) await store.del('budget:' + d.id);
    }
    await store.del(d.id);
    closeSheet(); render(); toast('Deleted.');
  },
  async 'start-fresh'() {
    await store.saveMany(DEFAULT_CATS.map(([name, type, icon]) => ({ id: catId(name, type), kind: 'cat', name, type, icon })));
    await store.setMeta('onboarded', true); render();
  },
  async 'import-csv'() {
    const file = await pickFile('.csv,text/csv,text/comma-separated-values');
    if (!file) return;
    try {
      const d = mapMonefy(await file.text());
      if (!d.txs.length) return toast('No transactions found in that file.');
      d.dupes = d.txs.filter((t) => store.raw(t.id)).length;
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
      render(); toast(n ? `Restored ${n.toLocaleString('en-CA')} records.` : 'Everything in that backup is already here.');
    } catch { toast('That file is not a Pennywise backup.'); }
  },
  async 'export-csv'() { await saveFile(`pennywise-${today()}.csv`, toCSV(txs(), (id) => catOf(id).name), 'text/csv'); },
  erase() {
    openSheet('confirm', { title: 'Erase data on this phone?', ok: 'Erase', text: `This removes all ${txs().length.toLocaleString('en-CA')} transactions from this phone and turns sync off here. ${sync.enabled() ? 'The other phone and the cloud copy are not affected.' : 'Save a backup first if you may want them back.'}`,
      run: async () => { await sync.disconnect(); await store.wipe(); await store.setMeta('onboarded', false); ui.tab = 'home'; } });
  },
  async 'sync-now'() { await sync.syncNow(); renderSheet(); render(); },
  async 'copy-code'() { try { await navigator.clipboard.writeText(sync.pairingCode()); toast('Pairing code copied.'); } catch { $('#f-code').select(); toast('Select and copy the code.'); } },
  async 'sync-off'() { await sync.disconnect(); closeSheet(); render(); toast('Sync turned off on this phone.'); },
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
});
document.addEventListener('submit', (e) => { e.preventDefault(); if (ui.sheet) SUBMIT[ui.sheet.type](ui.sheet.d); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });

/* ---------- boot ---------- */
(async () => {
  await store.init();
  await runRecurring();
  store.onChange((src) => { if (src === 'remote') { runRecurring(); render(); } });
  sync.onStatus(() => { if (!store.isEmpty() || store.getMeta('onboarded')) renderChrome(); if (ui.tab === 'more') render(); if (ui.sheet?.type === 'sync' && !ui.sheet.d.busy) renderSheet(); });
  sync.start();
  render();
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { await runRecurring(); if (!ui.sheet) render(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
