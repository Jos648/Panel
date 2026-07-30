import { gitBlobSha } from './sha1.js';
import { runPool } from './async.js';

/**
 * Değişiklik analizi.
 * Remote'da olmayan → YENİ (hash gerekmez, doğrudan işaretlenir).
 * Remote'da olanlar için yerel Git blob SHA-1 hesaplanır; SHA eşleşmesi =
 * içerik birebir aynı (GitHub'ın kendi karşılaştırmasıyla aynı matematik).
 *
 * ✅ FIX (Bug #3 — Sequential SHA-1): önceden 500 dosya × ~50ms sıralı await
 *    UI'ı 10+ saniye donduruyordu. Artık yalnızca remote'da eşleşen path'ler
 *    hash'leniyor ve bunlar 4 paralel işçi ile (runPool) işleniyor.
 */
export async function analyzeChanges(entries, remoteTree, onProgress) {
  // ✅ Yeni dosyalar hash gerektirmez — anında işaretle
  const newFiles = entries.filter(en => !remoteTree.has(en.path));
  newFiles.forEach(en => en.status = 'new');

  // ✅ Yalnızca remote'da var olan dosyalar hash kuyruğuna girer
  const needsHash = entries.filter(en => remoteTree.has(en.path));

  let processed = newFiles.length;
  onProgress?.(processed, entries.length);

  // ✅ FIX: 4 paralel işçi ile hash hesaplama (sıralı değil)
  await runPool(needsHash, 4, async (en) => {
    const remoteSha = remoteTree.get(en.path);
    en.status = (await gitBlobSha(en.file)) === remoteSha ? 'same' : 'mod';
    onProgress?.(++processed, entries.length);
  });

  return summarize(entries);
}

export function summarize(entries) {
  const counts = { new: 0, mod: 0, same: 0 };
  const byPath = new Map();
  for (const en of entries) {
    if (en.status) counts[en.status]++;
    byPath.set(en.path, en.status);
  }
  return { counts, byPath };
}
