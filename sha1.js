/**
 * Streaming SHA-1 (FIPS 180-1).
 * Git blob SHA'i, GitHub'ın ağaç API'sindeki SHA'lerle birebir karşılaştırma
 * yapabilmek için gereklidir: sha1("blob <boyut>\0" + içerik).
 * Streaming yazıldı ki 100MB'lık dosya tek seferde belleğe alınmasın.
 */
export function createSha1() {
  const H = new Int32Array([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]);
  const W = new Int32Array(80);
  const buf = new Uint8Array(64);
  let bufLen = 0, totalLen = 0;

  function compress(block) {
    for (let i = 0; i < 16; i++)
      W[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
    for (let i = 16; i < 80; i++) {
      const n = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
      W[i] = (n << 1) | (n >>> 31);
    }
    let [a, b, c, d, e] = H;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
  }

  // totalLen'i etkilemeyen iç yazma (padding için)
  function push(data) {
    let off = 0;
    if (bufLen) {
      const take = Math.min(64 - bufLen, data.length);
      buf.set(data.subarray(0, take), bufLen);
      bufLen += take; off = take;
      if (bufLen === 64) { compress(buf); bufLen = 0; }
    }
    while (off + 64 <= data.length) { compress(data.subarray(off, off + 64)); off += 64; }
    if (off < data.length) { buf.set(data.subarray(off), 0); bufLen = data.length - off; }
  }

  return {
    update(data) { totalLen += data.length; push(data); return this; },
    hex() {
      const bitLenHi = Math.floor((totalLen * 8) / 0x100000000);
      const bitLenLo = (totalLen * 8) >>> 0;
      const padLen = bufLen < 56 ? 56 - bufLen : 120 - bufLen;
      const pad = new Uint8Array(padLen + 8);
      pad[0] = 0x80;
      new DataView(pad.buffer).setUint32(padLen, bitLenHi);
      new DataView(pad.buffer).setUint32(padLen + 4, bitLenLo);
      push(pad);
      let out = '';
      for (let i = 0; i < 5; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0');
      return out;
    },
  };
}

/** Git blob SHA-1 — dosya 2MB'lık dilimlerle okunur (RAM dostu). */
export async function gitBlobSha(file) {
  const sha = createSha1();
  sha.update(new TextEncoder().encode(`blob ${file.size}\u0000`));
  const CHUNK = 2 * 1024 * 1024;
  for (let off = 0; off < file.size; off += CHUNK) {
    const part = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
    sha.update(part);
    // her dilim sonrası event loop doğal olarak serbest kalır → UI donmaz
  }
  return sha.hex();
}
