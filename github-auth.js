/**
 * DevDeck V1 — GitHub Device Flow (frontend tarafı)
 * worker.js'deki path'lerle (/login/device/code, /login/oauth/access_token)
 * BİREBİR eşleşmek zorunda. Kendi kodunda path farklıysa hata buradan çıkar.
 */

import { CONFIG } from './config.js';

async function startDeviceFlow() {
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

  // data: { device_code, user_code, verification_uri, expires_in, interval }
  return res.json();
}

async function pollForToken(deviceCode, initialInterval = 5) {
  let interval = initialInterval;

  while (true) {
    await new Promise((r) => setTimeout(r, interval * 1000));

    const res = await fetch(`${CONFIG.OAUTH_PROXY}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CONFIG.GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
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

/**
 * Kullanım:
 *   const { user_code, verification_uri } = await loginWithGitHub(showCodeToUser);
 * showCodeToUser callback'i, kullanıcıya user_code + verification_uri'yi
 * gösterip token gelene kadar UI'yı bekletmen için.
 */
export async function loginWithGitHub(onCodeReady) {
  const { device_code, user_code, verification_uri, interval } = await startDeviceFlow();

  if (typeof onCodeReady === 'function') {
    onCodeReady({ user_code, verification_uri });
  }

  const token = await pollForToken(device_code, interval);
  return token;
}

