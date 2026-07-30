import { CONFIG } from './config.js';
import { sanitizePath, isJunk } from './file-guard.js';

/**
 * Arşiv çıkarma.
 * ZIP  → JSZip (saf JS, async)
 * RAR/7Z → libarchive.js (WASM + Web Worker → ana thread hiç bloklanmaz)
 */

let libReady = false;
function ensureLibarchive() {
  if (typeof Archive === 'undefined')
    throw new Error('arşiv kütüphanesi yüklenemedi (ağ bağlantısını kontrol edin)');
  if (!libReady) { Archive.init({ workerUrl: CONFIG.LIBARCHIVE_WORKER }); libReady = true; }
}

export async function extractArchive(file, kind) {
  return kind === 'zip' ? extractZip(file) : extractWithLibarchive(file);
}

async function extractZip(file) {
  if (typeof JSZip === 'undefined') throw new Error('ZIP kütüphanesi yüklenemedi');
  const zip = await JSZip.loadAsync(file);
  const jobs = [];
  zip.forEach((path, entry) => { if (!entry.dir) jobs.push({ path, entry }); });

  const out = [];
  for (const { path, entry } of jobs) {
    let safe;
    try { safe = sanitizePath(path); } catch { continue; } // zip-slip koruması
    if (isJunk(safe)) continue;
    const blob = await entry.async('blob');
    out.push({ path: safe, file: new File([blob], safe.split('/').pop(), { type: blob.type }) });
  }
  return out;
}

async function extractWithLibarchive(file) {
  ensureLibarchive();
  const archive = await Archive.open(file);
  try {
    const out = [];
    flatten(await archive.getFilesObject(), '', out);
    return out;
  } finally {
    await archive.close(); // WASM belleğini derhal serbest bırak
  }
}

/** libarchive'in iç içe nesnesini düz {path, file} listesine çevirir. */
function flatten(node, prefix, out) {
  for (const [name, val] of Object.entries(node)) {
    if (name.endsWith('/')) continue; // dizin girdisi
    const path = prefix ? `${prefix}/${name}` : name;
    if (val instanceof File) {
      let safe;
      try { safe = sanitizePath(path); } catch { continue; }
      if (isJunk(safe)) continue;
      out.push({ path: safe, file: val });
    } else if (val && typeof val === 'object') {
      flatten(val, path, out); // iç içe klasörler aynen korunur
    }
  }
}
