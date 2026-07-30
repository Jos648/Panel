export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + units[i];
}

export function timeAgo(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return min + ' dk önce';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' sa önce';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + ' gün önce';
  const mo = Math.floor(day / 30);
  if (mo < 12) return mo + ' ay önce';
  return Math.floor(mo / 12) + ' yıl önce';
}

/** İstatistik kartları için küçük count-up animasyonu. */
export function animateNumber(node, to) {
  const from = Number(node.dataset.v ?? 0);
  node.dataset.v = to;
  if (from === to) { node.textContent = String(to); return; }
  const t0 = performance.now(), dur = 450;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    node.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
