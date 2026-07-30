import { $, el, icon } from './dom.js';

const ICONS = { ok: 'check', err: 'alert', warn: 'alert', info: 'info' };

/** Hafif bildirim katmanı — otomatik kapanır, erişilebilir (aria-live kökü). */
export function toast(message, type = 'info', timeout = 4200) {
  const node = el('div', { class: 'toast toast-' + type, role: 'status' },
    icon(ICONS[type] ?? 'info'),
    el('div', { class: 't-msg' }, message));
  $('#toast-root').append(node);
  // çift rAF: transition'ın başlangıç durumu yakalansın
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('show')));
  setTimeout(() => {
    node.classList.remove('show');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600); // transition kaçarsa güvenlik ağı
  }, timeout);
}
