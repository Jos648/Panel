/** İptal edilebilir bekleme (device flow polling için). */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('İptal edildi', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('İptal edildi', 'AbortError'));
    }, { once: true });
  });
}

/**
 * Dizi üzerinde sınırlı paralellikle async iş çalıştırır.
 * İlk hatada yeni iş başlatmayı keser, bitmekte olanları bekler, hatayı fırlatır.
 * GitHub rate-limit'i ve RAM disiplini için upload 3 paralelle sınırlıdır
 * (diff.js hash kuyruğu için 4 paralel kullanır).
 */
export async function runPool(items, limit, fn) {
  const queue = items.map((item, idx) => ({ item, idx }));
  let firstError = null;
  const worker = async () => {
    while (queue.length && !firstError) {
      const { item, idx } = queue.shift();
      try { await fn(item, idx); } catch (e) { firstError ??= e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (firstError) throw firstError;
}
