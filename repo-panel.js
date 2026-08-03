import { $, el, clear, icon } from './dom.js';
import { bus } from './event-bus.js';
import { store } from './store.js';
import { toast } from './toast.js';
import { listRepos, getRemoteTree } from './github-api.js';
import { timeAgo } from './format.js';

const LS_REPO = 'devdeck.repo'; // seçim kalıcıdır (hassas veri içermez)
let loading = false;

export function initRepoPanel() {
  bus.on('auth', (connected) => {
    if (connected) { render(); loadRepos(); }
    else { store.set({ repos: [] }); render(); }
  });
  bus.on('repo', render);
  $('#repo-search').addEventListener('input', renderList);
  $('#repo-refresh').addEventListener('click', () => loadRepos(true));
  render();
}

function render() {
  $('#panel-repo').classList.toggle('locked', !store.state.user);
  const chip = $('#repo-status');
  if (store.state.repo) { chip.className = 'chip chip-blue'; chip.textContent = store.state.repo.full_name; }
  else { chip.className = 'chip chip-mut'; chip.textContent = 'Seçilmedi'; }
  renderList();
}

async function loadRepos(manual) {
  if (!store.state.user) return;
  loading = true; renderList();
  try {
    const repos = await listRepos();
    store.set({ repos });
    // önceki seçim bu cihazda kayıtlıysa otomatik geri yükle
    const saved = localStorage.getItem(LS_REPO);
    if (saved && !store.state.repo) {
      const match = repos.find(r => r.full_name === saved);
      if (match) selectRepo(match, true);
    }
    if (manual) toast(repos.length + ' repo listelendi.', 'ok');
  } catch (e) {
    toast('Repolar alınamadı: ' + e.message, 'err');
  } finally {
    loading = false; renderList();
  }
}

function renderList() {
  const box = $('#repo-list');
  clear(box);
  if (!store.state.user) {
    box.append(el('div', { class: 'empty' }, 'GitHub’a bağlanınca repolarınız burada listelenir.'));
    return;
  }
  if (loading) {
    box.append(el('div', { class: 'empty' }, el('span', { class: 'spinner' }), ' Repolar yükleniyor…'));
    return;
  }
  const q = $('#repo-search').value.trim().toLowerCase();
  const rows = store.state.repos.filter(r => !q || r.full_name.toLowerCase().includes(q));
  if (!rows.length) {
    box.append(el('div', { class: 'empty' }, q ? 'Eşleşen repo yok.' : 'Henüz repo bulunamadı.'));
    return;
  }
  for (const r of rows) box.append(repoRow(r));
}

function repoRow(r) {
  const selected = store.state.repo?.full_name === r.full_name;
  return el('div', {
    class: 'repo-row' + (selected ? ' selected' : ''),
    role: 'button', tabindex: '0',
    onclick: () => selectRepo(r),
    onkeydown: (e) => { if (e.key === 'Enter') selectRepo(r); },
  },
    icon('repo'),
    el('div', { class: 'r-main' },
      el('div', { class: 'r-name' }, r.full_name, r.private ? el('span', { class: 'mini-badge' }, 'PRIVATE') : null),
      r.description ? el('div', { class: 'r-desc' }, r.description) : null),
    el('div', { class: 'r-meta' },
      el('span', { class: 'mono-chip' }, r.default_branch),
      el('span', { class: 'r-time' }, timeAgo(r.updated_at)),
      el('span', { class: 'r-check' }, icon('check'))));
}

function selectRepo(r, silent) {
  if (store.state.repo?.full_name === r.full_name) return;
  store.set({ repo: r, remoteTree: null, diff: null });
  localStorage.setItem(LS_REPO, r.full_name);
  bus.emit('repo', r);
  if (!silent) toast('Repo seçildi: ' + r.full_name, 'ok');
  fetchTree();
}

/** Seçilen reponun mevcut ağacı — değişiklik analizinin referansı. */
async function fetchTree() {
  const r = store.state.repo;
  try {
    const tree = await getRemoteTree(r.full_name, r.default_branch);
    if (store.state.repo?.full_name !== r.full_name) return; // bayat yanıt koruması
    store.set({ remoteTree: tree });
    bus.emit('tree', tree);
  } catch (e) {
    toast('Repo içeriği okunamadı: ' + e.message, 'err');
  }
}
