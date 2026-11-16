// Charts are hand-built HTML/SVG so the app has no dependencies and works offline.
import { esc, fmt, fmtRound, monthLabel } from './util.js';
import { t } from './i18n.js';

// Ranked horizontal bars: one hue, length = amount. Each row is a button that drills into the list.
export function categoryBars(items, drill = true) {
  const max = Math.max(...items.map((i) => i.amount), 1);
  const total = items.reduce((s, i) => s + i.amount, 0) || 1;
  return `<div class="bars">${items.map((i) => `
    <${drill ? `button class="bar-row" data-act="filter-cat" data-id="${esc(i.id)}"` : 'div class="bar-row static"'}>
      <span class="ico" aria-hidden="true">${esc(i.icon)}</span>
      <span class="bar-main">
        <span class="bar-head"><span class="bar-name">${esc(i.name)}</span>
          <span class="bar-val">${fmt(i.amount)} <small>${Math.round((i.amount / total) * 100)}%</small></span></span>
        <span class="track"><span class="fill ${i.cls || ''}" style="width:${Math.max((i.amount / max) * 100, 1.5)}%"></span></span>
      </span>
    </${drill ? 'button' : 'div'}>`).join('')}</div>`;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// Grouped bars: income vs expenses per month. Tap a month to read its exact numbers.
export function trendChart(months, selected) {
  const W = 340, H = 150, L = 38, T = 8, B = 22, pw = W - L, ph = H - T - B;
  const max = niceMax(Math.max(...months.flatMap((m) => [m.income, m.expense])) / 100) * 100;
  const gw = pw / months.length, bw = Math.min(14, (gw - 8) / 2);
  const y = (v) => T + ph - (v / max) * ph;
  const bar = (x, v, cls) => {
    if (v <= 0) return '';
    const h = Math.max((v / max) * ph, 2), r = Math.min(4, h, bw / 2), top = T + ph - h;
    return `<path class="${cls}" d="M${x},${T + ph}V${top + r}q0,-${r} ${r},-${r}h${bw - 2 * r}q${r},0 ${r},${r}V${T + ph}Z"/>`;
  };
  const grid = [0, 0.5, 1].map((f) => `
    <line class="grid" x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/>
    <text class="tick" x="${L - 6}" y="${y(max * f) + 3.5}" text-anchor="end">${fmtRound(max * f).replace(/ /g, '')}</text>`).join('');
  const groups = months.map((m, i) => {
    const cx = L + gw * i + gw / 2;
    return `<g>
      ${m.month === selected ? `<rect class="band" x="${L + gw * i + 2}" y="${T - 4}" width="${gw - 4}" height="${ph + 4}" rx="6"/>` : ''}
      ${bar(cx - bw - 1, m.income, 'inc')}${bar(cx + 1, m.expense, 'exp')}
      <text class="tick ${m.month === selected ? 'on' : ''}" x="${cx}" y="${H - 6}" text-anchor="middle">${monthLabel(m.month, true)}</text>
      <rect class="hit" data-act="trend" data-v="${m.month}" x="${L + gw * i}" y="0" width="${gw}" height="${H}"><title>${monthLabel(m.month)}: ${t('Income')} ${fmt(m.income)}, ${t('Expenses')} ${fmt(m.expense)}</title></rect>
    </g>`;
  }).join('');
  const s = months.find((m) => m.month === selected) || months[months.length - 1];
  return `
    <div class="legend">
      <span><i class="sw inc"></i>${t('Income')}</span><span><i class="sw exp"></i>${t('Expenses')}</span>
    </div>
    <svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('Income and expenses by month')}">${grid}${groups}</svg>
    <div class="readout"><b>${monthLabel(s.month)}</b><span>${t('Income')} ${fmt(s.income)}</span><span>${t('Expenses')} ${fmt(s.expense)}</span></div>`;
}
