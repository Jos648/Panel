/**
 * DevDeck V1 — GitHub Device Flow (frontend tarafı)
 * worker.js'deki path'lerle (/login/device/code, /login/oauth/access_token)
 * BİREBİR eşleşmek zorunda. Kendi kodunda path farklıysa hata buradan çıkar.
 */

import { CONFIG } from './config.js';
import { store } from './store.js';
import { getUser } from './github-api.js';

const TOKEN_KEY = 'devdeck.token';

export async function startDeviceFlow() {
  const res = await fetch(`${CONFIG.OAUTH_PROXY}/login/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CONFIG.GITHUB_CLIENT_ID,
      scope: CONFIG.SCOPES,
    }),
  });

  if (!res.ok) {
    throw new Error(`Device code isteği başarısız: HTTP ${res.status}`);
  }

  return res.json();
}

export async function pollForToken(deviceCode, initialInterval = 5, signal) {
  let interval = initialInterval;

  while (true) {
    if (signal?.aborted) {
      const err = new Error('Bağlantı akışı iptal edildi.');
      err.name = 'AbortError';
      throw err;
    }

    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, interval * 1000);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        const err = new Error('Bağlantı akışı iptal edildi.');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });

    const res = await fetch(`${CONFIG.OAUTH_PROXY}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CONFIG.GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      signal,
    });

    const data = await res.json();

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval += 5;
      continue;
    }
    if (data.error) {
      throw new Error(`GitHub hata döndü: ${data.error} — ${data.error_description ?? ''}`);
    }
  }
}

export async function completeLogin(token) {
  store.set({ token });
  sessionStorage.setItem(TOKEN_KEY, token);
  const user = await getUser();
  store.set({ user });
  return user;
}

export async function restoreSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return false;

  store.set({ token });
  try {
    const user = await getUser();
    store.set({ user });
    return true;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    store.set({ token: null, user: null });
    return false;
  }
}

export function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function loginWithGitHub(onCodeReady) {
  const { device_code, user_code, verification_uri, interval } = await startDeviceFlow();

  if (typeof onCodeReady === 'function') {
    onCodeReady({ user_code, verification_uri });
  }

  const token = await pollForToken(device_code, interval);
  return token;
}
