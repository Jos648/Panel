import { $, el, clear } from './dom.js';
import { bus } from './event-bus.js';
import { store } from './store.js';
import { toast } from './toast.js';

/** Sol ray: adım navigasyonu + canlı durum özeti. */
const STEPS = [
  { id: 'connect', panel: 'panel-connect', title: 'GitHub Bağlantısı' },
  { id: 'repo',    panel: 'panel-repo',    title: 'Repository Seçimi' },
  { id: 'files',   panel: 'panel-files',   title: 'Dosyalar & Analiz' },
  { id: 'upload',  panel: 'panel-upload',  title: "GitHub'a Yükle" },
];

export function renderRail() {
  $('#stepper').append(
    el('ol', { class: 'steps' }, STEPS.map((s, i) =>
      el('li', {
        class: 'step', 'data-step': s.id, 'data-idx': i,
        title: s.title, onclick: () => goTo(s),
      },
        el('span', { class: 's-dot' }, String(i + 1)),
        el('span', { class: 's-label' }, s.title)))));

  for (const evt of ['auth', 'repo', 'entries', 'diff', 'upload']) bus.on(evt, sync);
  setInterval(() => {
    const c = $('#sum-clock');
    if (c) c.textContent = new Date().toLocaleTimeString('tr-TR');
  }, 1000);
  sync();
}

function stepStates() {
  const st = store.state;
  const up = st.entries.filter(e => e.status === 'new' || e.status === 'mod').length;
  return {
    connect: { enabled: true,        done: !!st.user },
    repo:    { enabled: !!st.user,   done: !!st.repo },
    files:   { enabled: !!st.repo,   done: !!st.diff && st.entries.length > 0 },
    upload:  { enabled: !!st.repo && up > 0 && !st.uploading, done: !!st.lastCommit },
  };
}

function sync() {
  const states = stepStates();
  document.querySelectorAll('#stepper .step').forEach(li => {
    const s = states[li.dataset.step];
    li.classList.toggle('done', s.done);
    li.classList.toggle('enabled', s.enabled);
    li.querySelector('.s-dot').textContent = s.done ? '✓' : String(+li.dataset.idx + 1);
  });
  renderSummary();
}

function sumRow(k, v, on) {
  return el('div', { class: 'sum-row' }, el('span', {}, k), el('b', { class: on ? 'on' : '' }, v));
}

function renderSummary() {
  const box = $('#summary');
  clear(box);
  const st = store.state;
  const up = st.entries.filter(e => e.status === 'new' || e.status === 'mod').length;
  box.append(
    el('div', { class: 'sum-title' }, el('span', { class: 'pulse-dot' }), 'CANLI DURUM'),
    sumRow('Bağlantı', st.user ? '@' + st.user.login : '—', !!st.user),
    sumRow('Repo', st.repo ? st.repo.full_name : '—', !!st.repo),
    sumRow('Dosya', String(st.entries.length), st.entries.length > 0),
    sumRow('Değişiklik', up ? up + ' gönderilecek' : 'yok', up > 0),
    el('div', { class: 'sum-clock mono', id: 'sum-clock' }, new Date().toLocaleTimeString('tr-TR')));
}

function goTo(s) {
  if (!stepStates()[s.id].enabled) { toast('Önce önceki adımı tamamlayın.', 'warn'); return; }
  document.getElementById(s.panel).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Üst bar: bağlantı çipi + avatar. */
export function syncChrome() {
  const chip = $('#conn-chip'), av = $('#top-avatar');
  const u = store.state.user;
  clear(av);
  if (u) {
    chip.className = 'chip chip-ok';
    chip.textContent = u.login;
    av.append(el('img', {
      class: 'avatar',
      src: u.avatar_url + (u.avatar_url.includes('?') ? '&' : '?') + 's=64',
      alt: '',
    }));
  } else {
    chip.className = 'chip chip-mut';
    chip.textContent = 'Bağlı değil';
  }
}
