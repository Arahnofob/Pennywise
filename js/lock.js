// App lock: a 4-digit PIN checked when the app opens or comes back after a minute away.
// It is a privacy screen for someone holding your unlocked phone, not encryption.
// The PIN is per phone and never synced; only a salted hash is stored.
import { t } from './i18n.js';
import { esc } from './util.js';

const KEY = 'pw-pin';
let entered = '', hiddenAt = 0, onForgot = () => {};
const el = () => document.querySelector('#lock');
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

async function digest(salt, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const isSet = () => !!read();
export async function setPin(pin) {
  const salt = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16)).join('');
  localStorage.setItem(KEY, JSON.stringify({ salt, hash: await digest(salt, pin) }));
}
export const clearPin = () => localStorage.removeItem(KEY);
export const isLocked = () => !el().hidden;

function draw(msg = '') {
  el().innerHTML = `
    <img src="icons/icon.svg" alt="" width="64" height="64">
    <h1>${t('Enter your PIN')}</h1>
    <div class="dots" aria-label="${entered.length}/4">${[0, 1, 2, 3].map((i) => `<i class="${i < entered.length ? 'on' : ''}"></i>`).join('')}</div>
    <p class="lock-msg" role="alert">${esc(msg)}</p>
    <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-key="${n}">${n}</button>`).join('')}
      <span></span><button data-key="0">0</button><button data-key="back" aria-label="${t('Delete digit')}">⌫</button></div>
    <button class="btn ghost" data-key="forgot">${t('Forgot PIN?')}</button>`;
}
export function lock() {
  if (!isSet()) return;
  entered = ''; el().hidden = false; document.body.classList.add('locked'); draw();
}
function unlock() { el().hidden = true; el().innerHTML = ''; document.body.classList.remove('locked'); }

async function press(key) {
  if (key === 'forgot') return onForgot();
  if (key === 'back') entered = entered.slice(0, -1);
  else if (entered.length < 4) entered += key;
  draw();
  if (entered.length === 4) {
    const p = read();
    if (p && (await digest(p.salt, entered)) === p.hash) return unlock();
    entered = ''; draw(t('Wrong PIN. Try again.'));
  }
}

export function start(forgot) {
  onForgot = forgot;
  el().addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) press(b.dataset.key); });
  document.addEventListener('keydown', (e) => { if (!isLocked()) return; if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('back'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 60000) lock();
  });
  lock();
}
export { unlock };
