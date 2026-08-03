import { $, el, clear, icon } from './dom.js';
import { bus } from './event-bus.js';
import { store } from './store.js';
import { toast } from './toast.js';
import { CONFIG } from './config.js';
import { sanitizePath, isJunk, archiveKind } from './file-guard.js';
import { extractArchive } from './archives.js';
import { analyzeChanges } from './diff.js';
import { fmtBytes, animateNumber } from './format.js';

let dragDepth = 0;

export function initFilesPanel() {
  const dz = $('#dropzone');
  dz.addEventListener('click', (e) => { if (!e.target.closest('button')) $('#input-files').click(); });
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#input-files').click(); }
  });
  dz.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) dz.classList.add('over'); });
  dz.addEventListener('dragover', (e) => e.preventDefault());
  dz.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dz.classList.remove('over'); } });
  dz.addEventListener('drop', onDrop);

  $('#btn-pick-files').addEventListener('click', () => $('#input-files').click());
  $('#btn-pick-folder').addEventListener('click', () => $('#input-folder').click());
  $('#input-files').addEventListener('change', (e) => { ingest(fromList(e.target.files)); e.target.value = ''; });
  $('#input-folder').addEventListener('change', (e) => { ingest(fromList(e.target.files)); e.target.value = ''; });
  $('#btn-clear').addEventListener('click', () => clearAll(false));
  $('#btn-reanalyze').addEventListener('click', runDiff);

  bus.on('tree', runDiff);          // repo ağacı gelince mevcut dosyaları analiz et
  bus.on('repo', render);
  bus.on('entries', render);
  bus.on('diff', render);
  bus.on('auth', (ok) => { if (!ok) clearAll(true); });
  render();
}

/* ---------------- durum ---------------- */

function render() {
  const { repo, entries, diff } = store.state;
  $('#panel-files').classList.toggle('locked', !repo);
  const chip = $('#files-status');
  if (!entries.length) { chip.className = 'chip chip-mut'; chip.textContent = 'Dosya yok'; }
  else if (diff) { chip.className = 'chip chip-ok'; chip.textContent = entries.length + ' dosya analiz edildi'; }
  else { chip.className = 'chip chip-warn'; chip.textContent = 'Analiz bekleniyor'; }
  renderStats();
  renderTree();
}

function renderStats() {
  const box = $('#file-stats');
  const { entries, diff } = store.state;
  const has = entries.length > 0;
  box.hidden = !has;
  $('#tree-head').hidden = !has;
  if (!has) { clear(box); return; }

  const c = diff?.counts ?? { new: 0, mod: 0, same: 0 };
  const total = entries.reduce((s, e) => s + e.size, 0);
  const defs = [
    ['TOPLAM', entries.length, ''],
    ['BOYUT', fmtBytes(total), ''],
    ['YENİ', c.new, 'st-new'],
    ['GÜNCELLENECEK', c.mod, 'st-mod'],
    ['DEĞİŞMEDİ', c.same, 'st-same'],
  ];
  clear(box);
  for (const [label, val, cls] of defs) {
    const b = el('b', {}, '0');
    if (typeof val === 'number') animateNumber(b, val);
    else b.textContent = val;
    box.append(el('div', { class: 'stat ' + cls }, b, el('span', {}, label)));
  }
}

/* ---------------- dosya ağacı önizleme ---------------- */

function buildHierarchy(entries) {
  const root = { dirs: new Map(), files: [] };
  for (const en of entries) {
    const parts = en.path.split('/');
    let node = root;
    for (const p of parts.slice(0, -1)) {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [] });
      node = node.dirs.get(p);
    }
    node.files.push(en);
  }
  return root;
}

function countLeaves(node) {
  let n = node.files.length;
  for (const child of node.dirs.values()) n += countLeaves(child);
  return n;
}

function statusBadge(status) {
  if (status === 'new') return el('span', { class: 'badge badge-new' }, 'YENİ');
  if (status === 'mod') return el('span', { class: 'badge badge-mod' }, 'GÜNCEL');
  if (status === 'same') return el('span', { class: 'badge badge-same' }, 'AYNI');
  return el('span', { class: 'badge badge-wait' }, '…');
}

function renderNode(node, depth) {
  const ul = el('ul', { class: 'tree' });
  const cmp = (a, b) => a[0].localeCompare(b[0], 'tr');

  for (const [name, child] of [...node.dirs.entries()].sort(cmp)) {
    ul.append(el('li', {},
      el('details', { class: 't-dir', open: depth < 1 ? true : null },
        el('summary', { class: 't-row dir' },
          icon('folder'),
          el('span', { class: 't-name' }, name),
          el('span', { class: 't-count' }, countLeaves(child) + ' öğe'),
          el('span', { class: 'chev' }, '▾')),
        renderNode(child, depth + 1))));
  }
  for (const en of [...node.files].sort((a, b) => a.path.localeCompare(b.path, 'tr'))) {
    ul.append(el('li', { class: 't-row file' },
      icon('file'),
      el('span', { class: 't-name' }, en.path.split('/').pop()),
      el('span', { class: 't-path' }, en.path),
      el('span', { class: 't-size' }, fmtBytes(en.size)),
      statusBadge(en.status)));
  }
  return ul;
}

function renderTree() {
  const wrap = $('#file-tree');
  clear(wrap);
  if (!store.state.entries.length) return;
  wrap.append(renderNode(buildHierarchy(store.state.entries), 0));
}

/* ---------------- girdi toplama ---------------- */

const fromList = (list) =>
  [...list].map(f => ({ path: f.webkitRelativePath || f.name, file: f }));

async function onDrop(e) {
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').classList.remove('over');

  // Klasör sürüklemede yapıyı korumak için FileSystem entry API'si kullanılır
  const fsEntries = [...(e.dataTransfer?.items ?? [])]
    .map(it => it.webkitGetAsEntry?.())
    .filter(Boolean);

  if (!fsEntries.length) {
    ingest([...e.dataTransfer.files].map(f => ({ path: f.name, file: f })));
    return;
  }
  const collected = [];
  await Promise.all(fsEntries.map(en => traverse(en, collected)));
  ingest(collected);
}

function traverse(entry, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(
        (f) => { out.push({ path: (entry.fullPath || '/' + f.name).replace(/^\//, ''), file: f }); resolve(); },
        () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const read = () => reader.readEntries(async (batch) => {
        if (!batch.length) return resolve();
        await Promise.all(batch.map(b => traverse(b, out)));
        read(); // readEntries tek seferde en fazla 100 girdi verir
      }, () => resolve());
      read();
    } else resolve();
  });
}

/* ---------------- işleme (validate → extract → birleştir) ---------------- */

function setBusy(text) {
  $('#files-busy').hidden = !text;
  if (text) $('#files-busy-text').textContent = text;
}

async function ingest(items) {
  if (!items.length) return;
  if (!store.state.repo) { toast('Önce bir repository seçin.', 'warn'); return; }

  const direct = [], archives = [];
  for (const it of items) {
    const kind = archiveKind(it.path);
    if (kind === 'unsupported') {
      toast('Desteklenmeyen arşiv: ' + it.path + ' — V1 yalnızca ZIP, RAR ve 7Z açar.', 'err', 5500);
      continue;
    }
    kind ? archives.push({ ...it, kind }) : direct.push(it);
  }

  const collected = [...direct];
  for (const a of archives) {
    setBusy('Arşiv açılıyor: ' + a.path);
    try {
      collected.push(...await extractArchive(a.file, a.kind));
    } catch {
      toast('Arşiv açılamadı (' + a.path + '): bozuk ya da şifreli olabilir.', 'err', 5500);
    } finally {
      setBusy(null);
    }
  }
  mergeEntries(collected);
}

function mergeEntries(items) {
  const map = new Map(store.state.entries.map(e => [e.path, e]));
  let skipped = 0, oversize = 0;

  for (const it of items) {
    let path;
    try { path = sanitizePath(it.path); } catch { skipped++; continue; }
    if (isJunk(path)) { skipped++; continue; }
    if (it.file.size > CONFIG.MAX_FILE_BYTES) { oversize++; continue; }
    map.set(path, { path, file: it.file, size: it.file.size, status: null });
  }

  let entries = [...map.values()].sort((a, b) => a.path.localeCompare(b.path, 'tr'));
  if (entries.length > CONFIG.MAX_FILES) {
    entries = entries.slice(0, CONFIG.MAX_FILES);
    toast('Dosya sayısı ' + CONFIG.MAX_FILES + ' ile sınırlandırıldı.', 'warn');
  }
  let totalSize = entries.reduce((s, e) => s + e.size, 0);
  if (totalSize > CONFIG.MAX_TOTAL_BYTES) {
    while (entries.length && totalSize > CONFIG.MAX_TOTAL_BYTES) totalSize -= entries.pop().size;
    toast('Toplam ' + fmtBytes(CONFIG.MAX_TOTAL_BYTES) + ' sınırı aşıldı; liste kısaltıldı.', 'err', 5500);
  }

  if (skipped) toast(skipped + ' öğe atlandı (geçersiz ad veya sistem ambalaj dosyası).', 'warn');
  if (oversize) toast(oversize + ' dosya, dosya başına ' + fmtBytes(CONFIG.MAX_FILE_BYTES) + ' sınırını aştığı için atlandı.', 'err', 5500);

  store.set({ entries, diff: null });
  bus.emit('entries', entries);
  runDiff();
}

function clearAll(silent) {
  store.set({ entries: [], diff: null });
  bus.emit('entries', []);
  if (!silent) toast('Dosya listesi temizlendi.', 'info');
}

/* ---------------- değişiklik analizi ---------------- */

async function runDiff() {
  const { entries, remoteTree, repo } = store.state;
  if (!repo || !entries.length || !remoteTree) return;
  const load = $('#diff-loading');
  load.hidden = false;
  try {
    const diff = await analyzeChanges(entries, remoteTree, (i, n) => {
      $('#diff-loading-text').textContent = 'Repoyla karşılaştırılıyor… ' + i + '/' + n;
    });
    store.set({ diff });
    bus.emit('diff', diff);
  } catch (e) {
    toast('Analiz tamamlanamadı: ' + e.message, 'err');
  } finally {
    load.hidden = true;
  }
}
