import { CONFIG } from './config.js';
import { store } from './store.js';
import { bus } from './event-bus.js';
import { sleep } from './async.js';
import { getUser } from './github-api.js';

/**
 * GitHub OAuth 2.0 Device Flow.
 * - Şifre asla uygulamaya gelmez; kullanıcı github.com'da onaylar.
 * - Token localStorage'da tutulur: tarayıcı/sekme kapansa da kalıcıdır,
 *   yalnızca kullanıcı çıkış yapınca ya da elle temizleyince silinir.
 *   (Not: log'a/hata mesajına asla yazılmaz.)
 *
 * ✅ FIX: GitHub'ın gerçek endpoint yolları farklı:
 *    - device code isteği: https://github.com/login/device/code   (oauth/ YOK)
 *    - access token isteği: https://github.com/login/oauth/access_token (oauth/ VAR)
 *    Önceden ikisi de yanlışlıkla /oauth/ öneki ile kuruluyordu, bu da
 *    device/code isteğinin var olmayan bir adrese gitmesine ve GitHub'ın
 *    JSON yerine genel bir hata sayfası döndürmesine sebep oluyordu.
 */
const TOKEN_KEY = 'devdeck.token';
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

// ✅ FIX: path'e göre doğru GitHub tabanını seç
const GITHUB_PATHS = {
  'device/code': 'login/device/code',
  'access_token': 'login/oauth/access_token',
};

const oauthUrl = (path) => {
  const githubPath = GITHUB_PATHS[path] || ('login/oauth/' + path);
  return CONFIG.OAUTH_PROXY
    ? CONFIG.OAUTH_PROXY.replace(/\/$/, '') + '/' + path
    : 'https://github.com/' + githubPath;
};

async function postForm(path, params) {
  let res;
  try {
    res = await fetch(oauthUrl(path), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams(params),
    });
  } catch {
    throw new Error('GitHub OAuth servisine ulaşılamadı. Tarayıcı CORS engeli olabilir — config.js içindeki OAUTH_PROXY alanına bakın.');
  }
  return res.json().catch(() => ({}));
}

function translate(code) {
  return ({
    bad_verification_code: 'Doğrulama kodu geçersiz.',
    expired_token: 'Onay süresi doldu.',
    access_denied: 'Yetkilendirme reddedildi.',
    incorrect_client_credentials: 'Client ID hatalı — config.js kontrol edin.',
    unauthorized_client: 'Bu uygulama device flow için yetkisiz.',
  })[code] ?? '';
}

/** 1. adım: device_code + kullanıcı kodu al. */
export async function startDeviceFlow() {
  const data = await postForm('device/code', {
    client_id: CONFIG.GITHUB_CLIENT_ID,
    scope: CONFIG.SCOPES,
  });
  if (data.error || !data.device_code)
    throw new Error(translate(data.error) || 'Device flow başlatılamadı. GITHUB_CLIENT_ID değerini kontrol edin.');
  return data; // {device_code, user_code, verification_uri, interval, expires_in}
}

/** 2. adım: kullanıcı onaylayana kadar spec'e uygun aralıklarla poll et. */
export async function pollForToken(deviceCode, intervalSec, signal) {
  let wait = Math.max(5, intervalSec || 5) * 1000;
  const deadline = Date.now() + 890_000;
  while (Date.now() < deadline) {
    await sleep(wait, signal);
    const data = await postForm('access_token', {
      client_id: CONFIG.GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: GRANT,
    });
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { wait += 5000; continue; } // spec: intervalı uzat
    if (data.error === 'expired_token') throw new Error('Onay penceresi kapandı. Yeniden başlatın.');
    if (data.error === 'access_denied') throw new Error('Yetkilendirme reddedildi.');
    if (data.error) throw new Error(translate(data.error));
  }
  throw new Error('Onay süresi doldu.');
}

export async function completeLogin(token) {
  localStorage.setItem(TOKEN_KEY, token);
  store.set({ token });
  const user = await getUser();
  store.set({ user });
  bus.emit('auth', true);
  return user;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  store.set({ token: null, user: null });
  bus.emit('auth', false);
}

/** Sayfa/tarayıcı yeniden açıldığında kaydedilmiş token'ı doğrulayıp geri yükle. */
export async function restoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return false;
  store.set({ token });
  try {
    store.set({ user: await getUser() });
    return true;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    store.set({ token: null });
    return false;
  }
}
