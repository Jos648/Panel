/**
 * Güvenlik katmanı: yol doğrulama + arşiv türü tespiti.
 * Zip-Slip ve path traversal'a karşı tek savunma noktası burasıdır;
 * hem sürükle-bırak hem extract çıktıları buradan geçmek ZORUNDADIR.
 */

const JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Ham yolu güvenli, göreli, POSIX biçimli yola çevirir.
 * Kurallar: mutlak yol yok, ".." segmenti yok, kontrol karakteri yok,
 * Windows'a rezerve adlar yok, segment sonu nokta/boşluk yok.
 * İhlalde throw eder (çağıran öğeyi atlar).
 */
export function sanitizePath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('boş yol');
  const p = raw.replace(/\\/g, '/').replace(/\u0000/g, '').trim().replace(/^\/+/, '');
  if (!p) throw new Error('boş yol');

  const parts = p.split('/').filter(s => s !== '' && s !== '.');
  if (!parts.length) throw new Error('boş yol');

  for (const seg of parts) {
    if (seg === '..') throw new Error('path traversal girişimi engellendi');
    if (/[\u0000-\u001f\u007f]/.test(seg)) throw new Error('kontrol karakteri içeren yol');
    if (RESERVED.test(seg)) throw new Error('rezerve dosya adı');
    if (/[. ]$/.test(seg)) throw new Error('segment sonu nokta/boşluk');
  }
  return parts.join('/');
}

/** macOS/Windows ambalaj atıkları — gizli dosyalar DESTEKLENİR, sadece çöp filtrelenir. */
export function isJunk(path) {
  return path.toLowerCase().split('/').some(s =>
    JUNK.has(s) || s === '__macosx' || s.startsWith('._'));
}

/**
 * Upload için uygunluk kontrolü.
 * - Yollarda segment olarak ".git" geçiyorsa REDDİLİR (Git Data API güvenlik kısıtlaması).
 * - node_modules gibi gönderilmemesi gereken büyük dizinler de reddedilir.
 */
export function isUploadable(p) {
  if (typeof p !== 'string' || !p) return false;
  // normalize path separators, boş segmentleri çıkar
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.includes('.git')) return false;
  if (parts.includes('node_modules')) return false;
  return true;
}

const SUPPORTED = { zip: 'zip', rar: 'rar', '7z': '7z' };
const KNOWN_UNSUPPORTED = new Set(['tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'cab', 'lzh', 'arj']);

/** null → normal dosya · 'zip'|'rar'|'7z' → açılacak · 'unsupported' → kullanıcıya hata */
export function archiveKind(path) {
  const base = path.split('/').pop();
  const i = base.lastIndexOf('.');
  if (i < 1 || i === base.length - 1) return null;
  const ext = base.slice(i + 1).toLowerCase();
  if (SUPPORTED[ext]) return SUPPORTED[ext];
  if (KNOWN_UNSUPPORTED.has(ext)) return 'unsupported';
  return null;
}
