// CSV parsing (RFC 4180-ish) and the Monefy-export -> Pennywise mapping.
import { hash, parseAmount, signOf } from './util.js';
import { t } from './i18n.js';

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function parseDate(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const ICONS = [
  [/їжа|еда|продукт|food|grocer/i, '🛒'], [/кафе|ресторан|cafe|restaurant|eating/i, '☕'],
  [/рахунк|счет|счёт|bill|utilit/i, '🧾'], [/житло|жиль|дом|house|home|rent/i, '🏠'],
  [/таксі|такси|taxi/i, '🚕'], [/транспорт|transport|transit/i, '🚌'],
  [/подарун|подар|gift/i, '🎁'], [/гігієн|гигиен|toiletr|hygiene/i, '🧴'],
  [/зарплат|salary|paycheck|wage/i, '💼'], [/здоров|health|medic/i, '💊'],
  [/машин|авто|car|fuel|gas/i, '🚗'], [/розваг|развлеч|entertain|fun/i, '🎬'],
  [/одяг|одежд|cloth/i, '👕'], [/зв'?язок|связь|phone|mobile|internet|communic/i, '📱'],
  [/улюблен|питом|pet/i, '🐾'], [/спорт|sport|gym/i, '🏋️'],
  [/інвест|инвест|invest|tfsa|rrsp/i, '📈'],
  [/депозит|deposit/i, '🏦'], [/заощадж|сбереж|saving/i, '🐖'],
  [/travel|подорож|путешеств/i, '✈️'], [/educat|освіт|образован/i, '🎓'], [/kid|child|діт|дет/i, '🧸'],
];
export const guessIcon = (name, type) => ICONS.find(([re]) => re.test(name))?.[1] || (type === 'income' ? '💰' : '🏷️');
export const catId = (name, type) => 'cat:' + hash(type + '|' + name.trim().toLowerCase());

// Turns CSV text into { txs, cats, skipped, from, to }. Ids are deterministic, so importing
// the same file twice (or on both phones) never creates duplicates.
export function mapMonefy(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error(t('The file is empty.'));
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iDate = col('date'), iCat = col('category'), iAmt = col('amount'), iNote = col('description', 'note', 'notes');
  const iWho = col('who', 'person');
  if (iDate < 0 || iCat < 0 || iAmt < 0) throw new Error(t('This does not look like a Monefy export (need date, category and amount columns).'));
  const cats = new Map(), txs = [], seen = new Map();
  let skipped = 0, from = null, to = null;
  for (const r of rows.slice(1)) {
    const date = parseDate(r[iDate] || ''), amount = parseAmount(r[iAmt]);
    const name = (r[iCat] || '').trim() || 'Other';
    if (!date || amount == null || amount === 0) { skipped++; continue; }
    const type = signOf(r[iAmt]) < 0 ? 'expense' : 'income';
    const cid = catId(name, type);
    if (!cats.has(cid)) cats.set(cid, { id: cid, kind: 'cat', name, type, icon: guessIcon(name, type) });
    const note = iNote >= 0 ? (r[iNote] || '').trim() : '';
    const who = iWho >= 0 ? (r[iWho] || '').trim() : '';
    const key = [date, type, amount, name, note].join('|');
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    txs.push({ id: 'tx:i' + hash(key + '|' + n), kind: 'tx', date, type, amount, catId: cid, note, who });
    if (!from || date < from) from = date;
    if (!to || date > to) to = date;
  }
  return { txs, cats: [...cats.values()], skipped, from, to };
}

const q = (s) => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
export function toCSV(txs, catName) {
  const lines = ['date,category,amount,currency,description,who'];
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    const amt = ((t.type === 'expense' ? -1 : 1) * t.amount / 100).toString();
    lines.push([t.date, q(catName(t.catId)), amt, 'CAD', q(t.note || ''), q(t.who || '')].join(','));
  }
  return '﻿' + lines.join('\n') + '\n';
}
