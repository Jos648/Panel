/**
 * Tek kaynaklı uygulama durumu.
 * Değişiklikler bus üzerinden yayınlanır (paneller kendi emit'lerini yapar).
 * ✅ FIX (Bug #2 — Race Condition): set() + emit() artık atomik.
 *    batch() ile birden çok set() tek bir emit'e toplanır, ara durumlar
 *    dinleyicilere sızmaz.
 */
import { bus } from './event-bus.js';

const state = {
  token: null,      // OAuth access token (aynı zamanda sessionStorage'da)
  user: null,       // GitHub profil özeti
  repos: [],        // listelenen repolar
  repo: null,       // seçili repo {full_name, default_branch, ...}
  remoteTree: null, // Map<path, gitBlobSha> — seçili reponun mevcut durumu
  entries: [],      // {path, file, size, status} — gönderime aday yerel dosyalar
  diff: null,       // {counts:{new,mod,same}, byPath}
  uploading: false,
  lastCommit: null, // son başarılı commit sha
};

// ✅ FIX: batch sırasında ara emit'ler bastırılır
let inTransaction = false;

export const store = {
  state,

  set(patch) {
    Object.assign(state, patch);
    // ✅ FIX: batch içindeysek emit etme — batch() sonunda tek seferde emit edilecek
    if (!inTransaction) bus.emit('store-update', { ...state });
  },

  // ✅ NEW (Bug #2 fix): birden fazla set()'i tek atomik güncelleme olarak uygula.
  // Kullanım: store.batch(() => { store.set({a:1}); store.set({b:2}); });
  // → dinleyiciler yalnızca son, tutarlı durumu görür.
  batch(fn) {
    inTransaction = true;
    try {
      fn();
    } finally {
      inTransaction = false;
      bus.emit('store-update', { ...state });
    }
  },

  reset() {
    this.batch(() => {
      Object.assign(state, {
        token: null, user: null, repos: [], repo: null, remoteTree: null,
        entries: [], diff: null, uploading: false, lastCommit: null,
      });
    });
  },
};
