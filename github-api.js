import { store } from './store.js';
import { runPool, sleep } from './async.js';

/**
 * GitHub REST API sarmalayıcısı.
 * - Tüm istekler api.github.com'a (CORS açık).
 * - Hatalar GENEL mesajlara eşlenir: sunucunun ham mesajı hassas bilgi
 *   (iç yol, token ipucu, repo detayı) taşıyabileceği için UI'a hiç yansımaz.
 * ✅ FIX (Bug #4 — Network Error): tüm istekler artık apiWithRetry() üzerinden
 *    gider; 429/5xx hataları exponential backoff ile otomatik yeniden denenir.
 * ✅ FIX (Bug #1 — Boş Repo Crash): pushChanges() içinde baseCommit null ise
 *    baseTree artık açıkça null bırakılıyor (yanlışlıkla undefined kalmıyor),
 *    ve base_tree alanı yalnızca varsa gönderiliyor.
 */
const API = 'https://api.github.com';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function mapError(status) {
  switch (status) {
    case 401: return 'Oturum geçersiz ya da süresi dolmuş. Yeniden bağlanın.';
    case 403: return 'GitHub istek limiti aşıldı veya token yetkisi eksik. Kısa süre sonra tekrar deneyin.';
    case 404: return 'Kaynak bulunamadı. Repo özelse token yetkilerini kontrol edin.';
    case 409: return 'Repo boş ya da işlem çakıştı.';
    case 422: return 'İstek doğrulanamadı (dosya yolu ya da içerik kaynaklı olabilir).';
    default:  return 'GitHub API hatası (kod: ' + status + ').';
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const h = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + store.state.token,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body !== undefined) h['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API + path, {
      method, headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'GitHub API’ye ulaşılamadı (ağ hatası).');
  }
  if (res.status === 204) return null;

  let data = null;
  try { data = await res.json(); } catch { /* boş gövde */ }
  if (!res.ok) throw new ApiError(res.status, mapError(res.status));
  return data;
}

// ✅ NEW (Bug #4 fix): exponential backoff + jitter ile retry sarmalayıcısı.
// Yalnızca 429 (rate limit) ve 5xx (sunucu hatası) yeniden denenir;
// 401/404/422 gibi kalıcı hatalar hemen fırlatılır.
async function apiWithRetry(path, opts = {}, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await api(path, opts);
    } catch (e) {
      lastError = e;
      const isRetryable = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (isRetryable && attempt < maxRetries - 1) {
        const baseDelay = 1000 * Math.pow(2, attempt);
        const jitter = Math.random() * 500;
        const delay = Math.min(baseDelay + jitter, 10000);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

export const getUser = () => apiWithRetry('/user');

export async function listRepos() {
  const rows = await apiWithRetry('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return rows.map(r => ({
    full_name: r.full_name,
    private: r.private,
    default_branch: r.default_branch,
    updated_at: r.updated_at,
    description: r.description,
    url: r.html_url,
  }));
}

/**
 * Reponun TAM dosya ağacı + blob SHA'leri → yerel SHA'lerle karşılaştırma için.
 * Boş repoda 404/409 → boş Map döner (ilk commit senaryosu).
 */
export async function getRemoteTree(fullName, branch) {
  try {
    const data = await apiWithRetry(`/repos/${fullName}/git/trees/${branch}?recursive=1`);
    const map = new Map();
    for (const item of data.tree) if (item.type === 'blob') map.set(item.path, item.sha);
    if (data.truncated)
      console.warn('[DevDeck] Ağaç 100k öğe sınırına takıldı — karşılaştırma kısmi olacak.');
    return map;
  } catch (e) {
    if (e.status === 404 || e.status === 409) return new Map();
    throw e;
  }
}

/**
 * 3'ün üzerinde paralel istek atılmaz (rate-limit + RAM disiplini).
 * Dosya içeriği base64'e 768KB'lık (3'ün katı → temiz base64) dilimlerle çevrilir.
 */
async function fileToBase64(file) {
  let out = '';
  const CHUNK = 768 * 1024;
  for (let off = 0; off < file.size; off += CHUNK) {
    const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    out += btoa(bin);
    await sleep(0); // uzun dosyalarda UI'ı serbest bırak
  }
  return out;
}

/**
 * Git Data API ile atomik gönderim:
 * blob'lar → tree (base_tree ile sadece değişenler) → commit → ref güncelle.
 * ✅ FIX (Bug #1): boş repo (baseCommit null) durumunda baseTree açıkça null
 *    bırakılır ve base_tree alanı isteğe hiç eklenmez → 422 crash'i önler.
 */
export async function pushChanges({ repo, branch, changes, message, onPhase, onFile }) {
  const full = repo.full_name;

  onPhase?.('ref');
  let baseCommit = null;
  try {
    const ref = await apiWithRetry(`/repos/${full}/git/ref/heads/${branch}`);
    baseCommit = ref.object.sha;
  } catch (e) {
    if (e.status !== 404 && e.status !== 409) throw e; // boş repo → ilk commit
  }

  let baseTree = null;
  if (baseCommit) {
    const commitObj = await apiWithRetry(`/repos/${full}/git/commits/${baseCommit}`);
    baseTree = commitObj.tree.sha;
  } else {
    baseTree = null; // ✅ FIX: explicit — boş repo → base_tree yok
  }

  onPhase?.('blobs');
  const shas = new Array(changes.length);
  await runPool(changes, 3, async (en, idx) => {
    onFile?.(idx, 'start');
    const content = await fileToBase64(en.file);
    const blob = await apiWithRetry(`/repos/${full}/git/blobs`, {
      method: 'POST', body: { content, encoding: 'base64' },
    });
    shas[idx] = { path: en.path, sha: blob.sha };
    onFile?.(idx, 'done');
  });

  onPhase?.('tree');
  const tree = await apiWithRetry(`/repos/${full}/git/trees`, {
    method: 'POST',
    body: {
      ...(baseTree ? { base_tree: baseTree } : {}), // ✅ yalnızca baseTree varsa gönder
      tree: shas.map(s => ({ path: s.path, mode: '100644', type: 'blob', sha: s.sha })),
    },
  });

  onPhase?.('commit');
  const commit = await apiWithRetry(`/repos/${full}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents: baseCommit ? [baseCommit] : [] },
  });

  onPhase?.('push');
  if (baseCommit) {
    // ✅ mevcut branch güncelleniyor (GitHub API: update = /git/refs/... çoğul,
    //    get = /git/ref/... tekil — ikisi farklı endpoint, karıştırılmamalı)
    await apiWithRetry(`/repos/${full}/git/refs/heads/${branch}`, {
      method: 'PATCH', body: { sha: commit.sha, force: false },
    });
  } else {
    // ✅ boş repo → yeni branch oluşturuluyor
    await apiWithRetry(`/repos/${full}/git/refs`, {
      method: 'POST', body: { ref: `refs/heads/${branch || 'main'}`, sha: commit.sha },
    });
  }

  return { commit: { sha: commit.sha, url: commit.html_url }, shas };
}
