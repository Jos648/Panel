import { $, el, clear, icon, escapeHtml } from './dom.js';
import { bus } from './event-bus.js';
import { store } from './store.js';
import { toast } from './toast.js';
import { CONFIG } from './config.js';
import { pushChanges } from './github-api.js';
import { summarize } from './diff.js';
import { fmtBytes } from './format.js';

const PHASES = {
  ref: 'Commit referansı okunuyor…',
  blobs: 'Dosyalar gönderiliyor…',
  tree: 'Dosya ağacı oluşturuluyor…',
  commit: 'Commit oluşturuluyor…',
  push: 'Branch güncelleniyor…',
};

export function initUploadPanel() {
  $('#btn-push').addEventListener('click', startUpload);
  bus.on('diff', render);
  bus.on('entries', render);
  bus.on('repo', render);
  bus.on('auth', (ok) => { if (!ok) render(); });
  render();
}

const changes = () => store.state.entries.filter(e => e.status === 'new' || e.status === 'mod');

function render() {
  const { repo, uploading } = store.state;
  const list = changes();
  $('#panel-upload').classList.toggle('locked', !repo);

  const chip = $('#upload-status');
  if (uploading) { chip.className = 'chip chip-warn'; chip.textContent = 'Sürüyor…'; }
  else if (list.length) { chip.className = 'chip chip-ok'; chip.textContent = list.length + ' değişiklik'; }
  else { chip.className = 'chip chip-mut'; chip.textContent = 'Hazır değil'; }

  const sum = $('#upload-summary');
  clear(sum);
  if (repo) {
    sum.append(el('div', { class: 'up-target' },
      el('span', { class: 'arrow' }, '→'),
      el('span', { class: 'mono' }, repo.full_name + ' @ ' + repo.default_branch)));
    if (list.length) {
      const bytes = list.reduce((s, e) => s + e.size, 0);
      sum.append(el('div', { class: 'up-chips' },
        el('span', { class: 'chip chip-ok' }, list.filter(c => c.status === 'new').length + ' yeni'),
        el('span', { class: 'chip chip-warn' }, list.filter(c => c.status === 'mod').length + ' güncellenecek'),
        el('span', { class: 'chip chip-mut' }, fmtBytes(bytes))));
    } else {
      sum.append(el('div', { class: 'up-empty' }, 'Gönderilecek değişiklik yok — tüm dosyalar repoyla birebir aynı.'));
    }
  } else {
    sum.append(el('div', { class: 'up-empty' }, 'Repository seçildiğinde özet burada görünür.'));
  }

  const btn = $('#btn-push');
  btn.disabled = !list.length || uploading || !repo;
  clear(btn);
  btn.append(icon('upload'), uploading ? ' Yükleniyor…' : " GitHub'a Yükle");
  if (uploading) btn.append(el('span', { class: 'spinner' }));

  $('#push-note').textContent = list.length && repo
    ? 'tek commit · ' + repo.default_branch + ' branchine eklenir · dosya başı sınır ' + fmtBytes(CONFIG.MAX_FILE_BYTES)
    : '';
}

/* ---------------- yükleme akışı ---------------- */

function prepareProgress(list) {
  const area = $('#upload-progress');
  clear(area); area.hidden = false;
  clear($('#upload-banner'));
  const logBox = $('#upload-log');
  clear(logBox); logBox.hidden = false;

  const phase = el('div', { class: 'up-phase' }, 'Hazırlanıyor…');
  const pct = el('div', { class: 'prog-pct' }, '0%');
  const bar = el('div', { class: 'prog-bar' });
  const listEl = el('div', { class: 'up-list' });

  const rows = list.map(c => {
    const st = el('span', { class: 'up-st' }, el('span', { class: 'spinner' }));
    listEl.append(el('div', { class: 'up-row' },
      icon('file'),
      el('span', { class: 'up-path' }, c.path),
      el('span', { class: 'up-size' }, fmtBytes(c.size)),
      st));
    return { st };
  });

  area.append(
    el('div', { class: 'prog-head' }, phase, pct),
    el('div', { class: 'prog' }, bar),
    listEl);

  let done = 0;
  const setPct = () => {
    const p = Math.round((done / list.length) * 100);
    bar.style.width = p + '%';
    pct.textContent = p + '%';
  };

  return {
    phase: (p) => { phase.textContent = PHASES[p] ?? p; },
    file(idx, state) {
      const r = rows[idx];
      if (state === 'start') r.st.replaceChildren(el('span', { class: 'spinner' }));
      if (state === 'done') {
        done++;
        clear(r.st); r.st.append(icon('check'));
        r.st.parentElement.classList.add('ok');
        setPct();
      }
    },
    log(line, cls) {
      logBox.append(el('div', { class: 'log-line ' + (cls ?? '') },
        el('span', { class: 't' }, new Date().toLocaleTimeString('tr-TR') + '  '), line));
      logBox.scrollTop = logBox.scrollHeight;
    },
    banner(ok, html) {
      const b = $('#upload-banner');
      clear(b);
      b.append(el('div', { class: 'banner ' + (ok ? 'banner-ok' : 'banner-err') },
        icon(ok ? 'check' : 'alert'), el('div', { html })));
    },
  };
}

async function startUpload() {
  const { repo } = store.state;
  const list = changes();
  if (!list.length || !repo || store.state.uploading) return;

  store.set({ uploading: true, lastCommit: null });
  render();
  const ui = prepareProgress(list);
  const newCount = list.filter(c => c.status === 'new').length;
  const message = 'DevDeck V1: ' + newCount + ' yeni, ' + (list.length - newCount) + ' güncellenen dosya';

  ui.log('▸ Hedef: ' + repo.full_name + ' @ ' + repo.default_branch);
  ui.log('▸ ' + list.length + ' dosya (' + fmtBytes(list.reduce((s, e) => s + e.size, 0)) + ')');

  try {
    const result = await pushChanges({
      repo,
      branch: repo.default_branch,
      changes: list,
      message,
      onPhase: (p) => { ui.phase(p); ui.log('· ' + (PHASES[p] ?? p)); },
      onFile: (idx, st) => ui.file(idx, st),
    });

    // Yeni blob SHA'lerini uzak ağaca işle → sonraki analiz "değişmedi" üretir
    const tree = store.state.remoteTree ?? new Map();
    for (const s of result.shas) tree.set(s.path, s.sha);
    for (const c of list) c.status = 'same';
    store.set({
      remoteTree: tree,
      diff: summarize(store.state.entries),
      lastCommit: result.commit.sha,
      uploading: false,
    });

    ui.phase('Tamamlandı ✓');
    ui.log('✓ Commit oluşturuldu: ' + result.commit.sha.slice(0, 10), 'ok');
    ui.banner(true,
      'Yükleme başarılı — <b>' + list.length + ' dosya</b> gönderildi. ' +
      '<a href="' + result.commit.url + '" target="_blank" rel="noopener">Commit’i GitHub’da aç ↗</a>');
    toast('Yükleme tamamlandı.', 'ok');
    bus.emit('diff', store.state.diff);
  } catch (e) {
    store.set({ uploading: false });
    ui.log('✗ ' + e.message, 'err');
    ui.banner(false, 'Yükleme başarısız: <b>' + escapeHtml(e.message) + '</b>');
    toast('Yükleme başarısız oldu.', 'err');
  } finally {
    render();
  }
}
