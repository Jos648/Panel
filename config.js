/**
 * DevDeck V1 — merkezi yapılandırma.
 * Başka hiçbir dosyada sabit değer bırakma; her şey buradan akar.
 */
export const CONFIG = {
  // GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
  // ile oluşturduğun uygulamanın Client ID'si (secret GEREKMEZ, device flow kullanıyoruz).
  GITHUB_CLIENT_ID: 'Ov23lis1Hy01nazMrOxC',

  // Tarayıcı github.com/login/oauth/* isteklerini CORS nedeniyle engellerse
  // kendi küçük proxy'ni (örn. https://proxy.example.com → github.com/login/oauth/) buraya yaz.
  OAUTH_PROXY: null,

  SCOPES: 'repo', // özel repolar için gerekli

  // Güvenlik / performans sınırları
  MAX_FILE_BYTES: 100 * 1024 * 1024,  // GitHub blob API üst sınırı
  MAX_TOTAL_BYTES: 250 * 1024 * 1024, // tek seferde gönderim bütçesi
  MAX_FILES: 2000,

  // RAR/7Z çıkarma için WASM worker (libarchive.js)
  LIBARCHIVE_WORKER: 'https://cdn.jsdelivr.net/npm/libarchive.js@1.3.0/dist/worker-bundle.js',
};
