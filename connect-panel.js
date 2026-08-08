import { $, el, clear, icon } from './dom.js';
import { bus } from './event-bus.js';
import { store } from './store.js';
import { toast } from './toast.js';
import { CONFIG } from './config.js';
import { startDeviceFlow, pollForToken, completeLogin, logout } from './github-auth.js';

let aborter = null;

export function initConnectPanel() {
  bus.on('auth', render);
  render();
}

function render() {
  const body = $('#connect-body');
  clear(body);
  const chip = $('#connect-status');
  const u = store.state.user;

  if (u) {
    chip.className = 'chip chip-ok';
    chip.textContent = 'Bağlı';
    body.append(
      el('div', { class: 'profile' },
        el('img', { class: 'avatar-lg', src: u.avatar_url + (u.avatar_url.includes('?') ? '&' : '?') + 's=120', alt: '' }),
        el('div', { class: 'p-info' },
          el('div', { class: 'p-name' }, u.name || u.login),
          el('div', { class: 'p-login mono' }, '@' + u.login),
          el('div', { class: 'p-chips' },
            el('span', { class: 'chip chip-blue' }, 'scope: ' + CONFIG.SCOPES),
            el('span', { class: 'chip chip-mut' }, 'token: yalnızca bu sekme')))),
      el('div', { class: 'row-end' },
        el('button', { class: 'btn btn-danger', id: 'btn-unlink' }, icon('x'), ' Hesabı Kaldır'),
        el('p', { class: 'hint' }, 'Yetkiyi tamamen iptal için: GitHub → Settings → Applications → Authorized OAuth Apps.')));
    armConfirm($('#btn-unlink'));
  } else {
    chip.className = 'chip chip-mut';
    chip.textContent = 'Bağlı değil';
    body.append(
      el('p', { class: 'lead' },
        'Dosyalar tarayıcıdan doğrudan GitHub’a gönderilir; araya sunucu girmez. ',
        'Bağlantı ', el('b', {}, 'OAuth Device Flow'), ' ile kurulur — şifreniz bu panele hiç gelmez.'),
      el('div', { class: 'row-start' },
        el('button', { class: 'btn btn-primary btn-lg', id: 'btn-connect' }, icon('github'), ' GitHub ile Bağlan')),
      el('div', { class: 'hint-row' }, icon('shield'),
        ' Token bu sekmede (sessionStorage) tutulur; sekme kapanınca silinir, hata mesajlarında asla görünmez.'));
    $('#btn-connect').addEventListener('click', beginFlow);
  }
}

async function beginFlow() {
  if (!CONFIG.GITHUB_CLIENT_ID || CONFIG.GITHUB_CLIENT_ID.startsWith('GITHUB_CLIENT_ID')) {
    toast('Önce config.js dosyasına kendi OAuth App Client ID’nizi yazın (README → Kurulum).', 'warn', 6000);
    return;
  }
  const body = $('#connect-body');
  try {
    const flow = await startDeviceFlow();
    aborter = new AbortController();
    clear(body);
    body.append(
      el('div', { class: 'flow' },
        el('p', { class: 'flow-title' }, 'GitHub aşağıdaki kodu isteyecek'),
        el('div', { class: 'flow-code mono' }, flow.user_code),
        el('div', {},
          el('a', { class: 'btn btn-ghost', href: flow.verification_uri, target: '_blank', rel: 'noopener' },
            icon('ext'), ' Doğrulama sayfasını aç')),
        el('p', { class: 'flow-wait' }, el('span', { class: 'pulse-dot' }), ' Onay bekleniyor… kodu girip Authorize’a basın.'),
        el('button', { class: 'btn btn-ghost btn-sm', id: 'btn-cancel' }, 'Vazgeç')));
    $('#btn-cancel').addEventListener('click', () => aborter.abort());

    const token = await pollForToken(flow.device_code, flow.interval, aborter.signal);
    await completeLogin(token);
    toast('GitHub hesabı bağlandı: ' + store.state.user.login, 'ok');
  } catch (e) {
    if (e.name === 'AbortError') toast('Bağlantı akışı iptal edildi.', 'info');
    else toast(e.message, 'err', 6000);
    render();
  }
}

/** İki aşamalı onay: ilk tık silahlandırır, 4 sn içinde ikinci tık kaldırır. */
function armConfirm(btn) {
  let timer = null;
  btn.addEventListener('click', () => {
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'Emin misin? Onayla';
      timer = setTimeout(() => {
        btn.classList.remove('armed');
        clear(btn); btn.append(icon('x'), ' Hesabı Kaldır');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    unlink();
  });
}

function unlink() {
  logout();
  localStorage.removeItem('devdeck.repo');
  store.reset();
  bus.emit('auth', false);
  bus.emit('repo', null);
  bus.emit('entries', []);
  toast('Hesap kaldırıldı; token bu cihazdan tamamen silindi.', 'info');
  render();
}

