import { icon } from './dom.js';
import { bus } from './event-bus.js';
import { restoreSession } from './github-auth.js';
import { renderRail, syncChrome } from './rail.js';
import { initConnectPanel } from './connect-panel.js';
import { initRepoPanel } from './repo-panel.js';
import { initFilesPanel } from './files-panel.js';
import { initUploadPanel } from './upload-panel.js';

/* Bootstrap — paneller yalnızca bus üzerinden haberleşir. */

// Statik ikonları yerleştir
document.querySelectorAll('[data-icon]').forEach(n => n.prepend(icon(n.dataset.icon)));

// Yanlışlıkla sayfaya bırakılan dosyalar sekmeyi ele geçirmesin
for (const evt of ['dragover', 'drop']) window.addEventListener(evt, e => e.preventDefault());

renderRail();
initConnectPanel();
initRepoPanel();
initFilesPanel();
initUploadPanel();

bus.on('auth', syncChrome);

// Aynı sekmede daha önce kurulmuş oturum varsa doğrula ve geri yükle
(async () => {
  const ok = await restoreSession();
  if (ok) bus.emit('auth', true); // repo listesi otomatik yüklenir
  syncChrome();
})();
