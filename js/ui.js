// The app shell: navigation, the pairing flow, verification and reconnection.
//
// This is the only module that knows which signaling adapter is in use. The
// camera and file modules just receive a connected RTCSession through the
// shared `app` object, which is why swapping the adapter changes nothing else.

import { SESSION_CONFIG } from '../config.js';
import { RTCSession, Emitter } from './rtc.js';
import { createPeerJsSignaling, peerJsAvailable } from './signaling-peerjs.js';
import { createMqttSignaling, mqttAvailable } from './signaling-mqtt.js';
import {
  generatePairingCode,
  normalizeCode,
  formatCode,
  assertCryptoAvailable,
  computeVerificationNumber,
} from './crypto.js';
import { Settings, applyTheme, mountSettings } from './settings.js';
import { t, setLanguage, translateDom, getLanguage } from './i18n.js';
import { initCamera } from './camera.js';
import { initFiles } from './files.js';

/* ------------------------------------------------------------------ *
 * Shared app object
 * ------------------------------------------------------------------ */

const app = new Emitter();
app.role = document.body.dataset.role === 'phone' ? 'phone' : 'laptop';
app.settings = new Settings();
app.session = null;
app.peerName = '';
app.t = t;
app.language = getLanguage;

/** Runtime state for the pairing flow. */
const runtime = {
  code: null,
  issuedAt: 0,
  adapter: null,
  session: null,
  status: 'disconnected',
  reconnectAttempts: 0,
  suppressReconnect: false,
  epoch: 0,
  verifyNumber: '',
  countdownTimer: null,
  statsTimer: null,
  reconnectTimer: null,
  resolveHello: null,
  helloPromise: null,
};

const $ = (selector) => document.querySelector(selector);

/* ------------------------------------------------------------------ *
 * Small UI helpers
 * ------------------------------------------------------------------ */

function toast(message, kind = 'info') {
  const host = $('#toasts');
  if (!host || !message) return;
  const node = document.createElement('div');
  node.className = 'toast toast-' + kind;
  node.setAttribute('role', 'status');
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 250);
  }, 4000);
}

function showNotice(text) {
  const notice = $('#notice');
  if (!notice) return;
  const body = notice.querySelector('[data-notice-text]') || notice;
  body.textContent = text;
  notice.hidden = false;
}

function hideNotice() {
  const notice = $('#notice');
  if (notice) notice.hidden = true;
}

function setStatus(status, detail) {
  runtime.status = status;
  const pill = $('#status-pill');
  if (pill) {
    pill.dataset.state = status;
    const label = pill.querySelector('[data-status-text]');
    if (label) {
      label.textContent =
        status === 'connected'
          ? t('status.connected')
          : status === 'waiting'
            ? t('status.waiting')
            : status === 'connecting'
              ? t('status.connecting')
              : t('status.disconnected');
    }
  }
  const disconnect = $('#disconnect-btn');
  if (disconnect) disconnect.hidden = !(status === 'connected' || status === 'waiting' || status === 'connecting');
  const inline = $('[data-connect-detail]');
  if (inline) inline.textContent = detail || '';
  if (status === 'disconnected') {
    app.peerName = '';
    updateDeviceName();
  }
}

function updateDeviceName() {
  const node = $('#device-name');
  if (!node) return;
  node.textContent = app.peerName || '';
  node.hidden = !app.peerName;
}

function showScreen(name) {
  document.querySelectorAll('[data-screen]').forEach((section) => {
    section.classList.toggle('is-active', section.dataset.screen === name);
  });
  document.querySelectorAll('[data-nav]').forEach((button) => {
    const active = button.dataset.nav === name;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  // Keep the hash so a reload or share keeps the user where they were.
  try {
    history.replaceState(null, '', '#' + name);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Pairing code screen (laptop)
 * ------------------------------------------------------------------ */

function phonePageUrl(code) {
  // Build the phone URL from the current location so it works at a domain
  // root, under a sub-path and on localhost.
  const base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
  const url = new URL(base + 'phone.html', location.href);
  url.search = '';
  url.hash = '';
  if (code) url.searchParams.set('code', code);
  return url.toString();
}

function renderCode() {
  const display = $('#code-display');
  if (!display) return;
  const code = runtime.code || '';
  display.textContent = formatCode(code);
  display.setAttribute('aria-label', t('connect.codeLabel') + ': ' + formatCode(code));

  const qrHost = $('#qr-container');
  if (qrHost) {
    qrHost.textContent = '';
    try {
      if (typeof window.qrcode === 'function') {
        const qr = window.qrcode(0, 'M');
        qr.addData(phonePageUrl(code));
        qr.make();
        qrHost.innerHTML = qr.createSvgTag({
          cellSize: 5,
          margin: 8,
          alt: t('connect.qrAlt'),
        });
      } else {
        // QR generator missing: still usable, the code can be typed by hand.
        qrHost.innerHTML = `<p class="muted small">${t('common.unsupported')}</p>`;
      }
    } catch {
      qrHost.innerHTML = `<p class="muted small">${t('common.unsupported')}</p>`;
    }
  }

  const openPhone = $('#open-phone-link');
  if (openPhone) openPhone.href = phonePageUrl(code);
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function tickCountdown() {
  const remaining = SESSION_CONFIG.codeTtlMs - (Date.now() - runtime.issuedAt);
  const node = $('#code-expiry');
  if (remaining <= 0) {
    clearInterval(runtime.countdownTimer);
    runtime.countdownTimer = null;
    if (node) node.textContent = t('connect.expired');
    if (runtime.status === 'waiting') {
      void teardownSession();
      setStatus('disconnected');
      showInlineError('errors.codeExpired');
    }
    return;
  }
  if (node) node.textContent = t('connect.expiresIn', { time: formatClock(remaining) });
}

function newCode({ listen = true } = {}) {
  runtime.code = generatePairingCode(SESSION_CONFIG.codeLength);
  runtime.issuedAt = Date.now();
  renderCode();
  clearInterval(runtime.countdownTimer);
  runtime.countdownTimer = setInterval(tickCountdown, 1000);
  tickCountdown();
  hideInlineError();
  if (listen && app.role === 'laptop') void hostListen();
}

/* ------------------------------------------------------------------ *
 * Errors on the connect screen
 * ------------------------------------------------------------------ */

function showInlineError(key) {
  const node = app.role === 'phone' ? $('#phone-connect-status') : $('#connect-status');
  if (!node) return;
  node.textContent = t(key);
  node.className = 'inline-status is-error';
  node.hidden = false;
}

function hideInlineError() {
  const node = app.role === 'phone' ? $('#phone-connect-status') : $('#connect-status');
  if (node) node.hidden = true;
}

/* ------------------------------------------------------------------ *
 * Signaling adapters (A: PeerJS, B: MQTT)
 * ------------------------------------------------------------------ */

/**
 * Start signaling, falling back from PeerJS to MQTT automatically.
 * Resolves with a started adapter, or null if the attempt became stale.
 */
function startSignaling(code) {
  const epoch = runtime.epoch;
  // Signaling adapters speak in host/guest terms; the UI speaks laptop/phone.
  const signalRole = app.role === 'laptop' ? 'host' : 'guest';
  return new Promise((resolve, reject) => {
    let settled = false;

    const tryAdapter = (kind) => {
      if (epoch !== runtime.epoch) {
        settled = true;
        resolve(null);
        return;
      }

      let adapter;
      if (kind === 'mqtt') {
        if (!mqttAvailable()) {
          settled = true;
          reject({ key: 'errors.allServicesUnreachable' });
          return;
        }
        adapter = createMqttSignaling({ code, role: signalRole });
      } else {
        if (!peerJsAvailable()) {
          tryAdapter('mqtt');
          return;
        }
        adapter = createPeerJsSignaling({ code, role: signalRole });
      }

      const cleanup = () => {
        adapter.off('ready', onReady);
        adapter.off('fatal', onFatal);
        adapter.off('unreachable', onUnreachable);
        adapter.off('error', onError);
      };
      const settle = (fn, arg) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(arg);
      };

      const onReady = () => settle(resolve, adapter);
      const onFatal = (info) => {
        adapter.close();
        settle(reject, { key: info?.code || 'errors.connectionFailed' });
      };
      const onUnreachable = () => {
        adapter.close();
        if (kind === 'peerjs') {
          // PeerJS failed: switch to the public backup service.
          showNotice(t('fallback.notice'));
          app.emit('fallback');
          tryAdapter('mqtt');
        } else {
          settle(reject, { key: 'errors.allServicesUnreachable' });
        }
      };
      const onError = (info) => {
        // Errors before we are ready are already handled by the Adapter;
        // keep the console useful without spamming the UI.
        if (!settled) console.warn('[linkdrop] signaling:', info?.code || info);
      };

      adapter.on('ready', onReady);
      adapter.on('fatal', onFatal);
      adapter.on('unreachable', onUnreachable);
      adapter.on('error', onError);
      Promise.resolve(adapter.start()).catch(() => onUnreachable());
    };

    tryAdapter('peerjs');
  });
}

/* ------------------------------------------------------------------ *
 * Session lifecycle
 * ------------------------------------------------------------------ */

async function teardownSession() {
  runtime.epoch++;
  stopStatsPolling();
  clearTimeout(runtime.reconnectTimer);
  runtime.reconnectTimer = null;

  const session = runtime.session;
  const adapter = runtime.adapter;
  runtime.session = null;
  runtime.adapter = null;
  app.session = null;

  try {
    session?.close('teardown');
  } catch {
    /* ignore */
  }
  try {
    adapter?.close();
  } catch {
    /* ignore */
  }
  app.emit('session', null);
}

function wireSession(session) {
  runtime.helloPromise = new Promise((resolve) => {
    runtime.resolveHello = resolve;
  });

  session.on('signaling-error', (info) => {
    if (session !== runtime.session) return;
    console.warn('[linkdrop] signaling:', info?.code || info);
  });

  session.on('fallback', () => showNotice(t('fallback.notice')));

  session.on('stream', (stream) => {
    if (session !== runtime.session) return;
    app.emit('stream', stream);
  });

  session.on('open', () => {
    if (session !== runtime.session) return;
    void onChannelsOpen(session);
  });

  session.on('message', (message) => {
    if (session !== runtime.session) return;
    onControlMessage(message);
  });

  session.on('channel-close', () => {
    if (session !== runtime.session) return;
    if (runtime.status === 'connected') handleLost();
  });

  session.on('lost', () => {
    if (session !== runtime.session) return;
    handleLost();
  });

  session.on('error', (info) => {
    console.warn('[linkdrop] session:', info?.scope || '', info?.error || info);
  });
}

/** Guest role: publish the phone's camera and offer the connection. */
async function joinSession(input) {
  const code = normalizeCode(input);
  if (code.length !== SESSION_CONFIG.codeLength) {
    showInlineError('errors.wrongOrExpiredCode');
    return;
  }

  runtime.suppressReconnect = true;
  await teardownSession();
  runtime.suppressReconnect = false;

  runtime.code = code;
  runtime.issuedAt = Date.now();
  setStatus('connecting');
  hideInlineError();

  // The guest is the offerer, so the camera has to be ready first. This is
  // also the moment the browser shows its camera permission prompt.
  let stream;
  try {
    stream = await app.camera.ensureStream();
  } catch (err) {
    showInlineError(err?.key || 'errors.cameraFailed');
    setStatus('disconnected');
    return;
  }

  try {
    const adapter = await startSignaling(code);
    if (!adapter) return; // teardown happened while we waited

    runtime.adapter = adapter;
    const session = new RTCSession({ role: 'guest', signaling: adapter });
    runtime.session = session;
    app.session = session;

    wireSession(session);
    await session.start();
    if (stream) session.addStream(stream);
    app.emit('session', session);

    await session.createOffer();
  } catch (err) {
    showInlineError(err?.key || 'errors.connectionFailed');
    toast(t(err?.key || 'errors.connectionFailed'), 'error');
    await teardownSession();
    setStatus('disconnected');
  }
}

/** Host role: announce the code and wait for one phone. */
async function hostListen() {
  if (!runtime.code) return;

  runtime.suppressReconnect = true;
  await teardownSession();
  runtime.suppressReconnect = false;

  if (!runtime.issuedAt) runtime.issuedAt = Date.now();
  setStatus('waiting');
  hideInlineError();
  updateDeviceName();

  try {
    const adapter = await startSignaling(runtime.code);
    if (!adapter) return;

    runtime.adapter = adapter;
    const session = new RTCSession({ role: 'host', signaling: adapter });
    runtime.session = session;
    app.session = session;

    wireSession(session);
    await session.start();
    app.emit('session', session);
  } catch (err) {
    showInlineError(err?.key || 'errors.connectionFailed');
    setStatus('disconnected');
  }
}

/* ------------------------------------------------------------------ *
 * Handshake, verification and activation
 * ------------------------------------------------------------------ */

function onControlMessage(message) {
  switch (message?.t) {
    case 'hello':
      app.peerName = message.name || (app.role === 'phone' ? 'Laptop' : 'Phone');
      updateDeviceName();
      runtime.resolveHello?.(app.peerName);
      app.emit('peer-name', app.peerName);
      break;
    case 'accept':
      if (app.role === 'phone') activateSession();
      break;
    case 'reject':
      if (app.role === 'phone') {
        toast(t('verify.rejected'), 'error');
        void teardownSession().then(() => {
          setStatus('disconnected');
          hideVerify();
          showScreen('connect');
          showInlineError('verify.rejected');
        });
      }
      break;
    default:
      app.emit('control', message);
      break;
  }
}

async function onChannelsOpen(session) {
  // Introduce ourselves so the other side can show a friendly name.
  session.sendControl({ t: 'hello', name: app.settings.deviceName, role: app.role });

  // The 4-digit number proves both screens see the same two certificates.
  try {
    const { local, remote } = await session.getFingerprints();
    runtime.verifyNumber = await computeVerificationNumber(local, remote);
  } catch {
    runtime.verifyNumber = '';
  }

  if (app.role === 'laptop') await hostVerify(session);
  else showGuestVerify();
}

async function hostVerify(session) {
  const number = runtime.verifyNumber || '----';
  // Wait briefly for the phone's hello so we can show its name.
  const name =
    app.peerName || (await Promise.race([
      runtime.helloPromise,
      new Promise((resolve) => setTimeout(() => resolve(t('conn.device')), 2000)),
    ])) || t('conn.device');

  if (runtime.verifyNumber && app.settings.isTrusted(number, name)) {
    toast(t('verify.trusted'));
    acceptDevice(session);
    return;
  }

  showHostVerify({
    name,
    number,
    onAllow: () => {
      if (app.settings.get('rememberDevice') && runtime.verifyNumber) {
        app.settings.trust(number, name);
      }
      acceptDevice(session);
    },
    onDeny: () => {
      session.sendControl({ t: 'reject' });
      toast(t('verify.rejected'), 'warn');
      // Refusing a device should not leave the old code sitting around.
      runtime.suppressReconnect = true;
      void teardownSession().then(() => {
        runtime.suppressReconnect = false;
        newCode();
      });
    },
  });
}

/**
 * The host has accepted the device: tell the phone over the control channel
 * (that is what flips it out of the verification dialog) and go live locally.
 */
function acceptDevice(session) {
  try {
    session.sendControl({ t: 'accept' });
  } catch {
    // If the channel is already gone the phone will simply time out.
  }
  activateSession();
}

function activateSession() {
  hideVerify();
  runtime.reconnectAttempts = 0;
  setStatus('connected');
  startStatsPolling();
  app.emit('activated');
  showScreen('camera');
}

/* ------------------------------------------------------------------ *
 * Verification dialog
 * ------------------------------------------------------------------ */

function verifyModal() {
  return $('#verify-modal');
}

function hideVerify() {
  const modal = verifyModal();
  if (modal) {
    modal.hidden = true;
    modal.textContent = '';
  }
}

function buildVerifyShell(titleKey) {
  const modal = verifyModal();
  modal.textContent = '';
  modal.hidden = false;

  const card = document.createElement('div');
  card.className = 'modal-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'verify-title');

  const title = document.createElement('h2');
  title.id = 'verify-title';
  title.className = 'modal-title';
  title.textContent = t(titleKey);

  const code = document.createElement('div');
  code.className = 'verify-code';
  code.textContent = runtime.verifyNumber || '----';
  code.setAttribute('aria-label', t('verify.numberLabel'));

  const label = document.createElement('p');
  label.className = 'muted small';
  label.textContent = t('verify.numberLabel');

  card.append(title, code, label);
  modal.appendChild(card);
  return { card, title, code, label };
}

function showHostVerify({ name, number, onAllow, onDeny }) {
  const { card, title } = buildVerifyShell('verify.allowTitle');
  const body = document.createElement('p');
  body.className = 'modal-body';
  body.textContent = t('verify.allowBody', { name });
  card.insertBefore(body, card.children[1]);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const deny = document.createElement('button');
  deny.type = 'button';
  deny.className = 'btn btn-ghost';
  deny.textContent = t('verify.deny');
  deny.addEventListener('click', onDeny);
  const allow = document.createElement('button');
  allow.type = 'button';
  allow.className = 'btn btn-primary';
  allow.textContent = t('verify.allow');
  allow.addEventListener('click', onAllow);
  actions.append(deny, allow);
  card.appendChild(actions);

  // Focus the primary action so keyboard users can act immediately.
  allow.focus();
  title.setAttribute('tabindex', '-1');
}

function showGuestVerify() {
  const { card } = buildVerifyShell('phone.connectTitle');

  const hint = document.createElement('p');
  hint.className = 'modal-body';
  hint.textContent = t('verify.phoneCheck');

  const waiting = document.createElement('p');
  waiting.className = 'muted small waiting-line';
  waiting.textContent = t('verify.waitingAccept');

  card.append(hint, waiting);
}

/* ------------------------------------------------------------------ *
 * Statistics polling
 * ------------------------------------------------------------------ */

function startStatsPolling() {
  stopStatsPolling();
  runtime.statsTimer = setInterval(async () => {
    const session = runtime.session;
    if (!session || !session.isConnected) return;
    const stats = await session.getStats();

    const typeNode = $('[data-conn-type]');
    if (typeNode) {
      typeNode.textContent = stats.connectionType
        ? stats.connectionType === 'relayed'
          ? t('conn.type.relayed')
          : t('conn.type.local')
        : '—';
    }
    const latencyNode = $('[data-conn-latency]');
    if (latencyNode) latencyNode.textContent = stats.rttMs != null ? `${stats.rttMs} ms` : '—';

    const setStat = (name, value) => {
      const node = document.querySelector(`[data-stat="${name}"]`);
      if (node) node.textContent = value;
    };
    setStat('resolution', stats.width ? `${stats.width}×${stats.height}` : '—');
    setStat('fps', stats.fps ? String(Math.round(stats.fps)) : '—');
    setStat('bitrate', stats.bitrateKbps ? `${stats.bitrateKbps} kbps` : '—');
  }, 2000);
}

function stopStatsPolling() {
  clearInterval(runtime.statsTimer);
  runtime.statsTimer = null;
}

/* ------------------------------------------------------------------ *
 * Disconnect and reconnect
 * ------------------------------------------------------------------ */

function handleLost() {
  if (runtime.suppressReconnect) return;
  if (runtime.status === 'connected') {
    toast(t('errors.channelClosed'), 'warn');
    app.emit('disconnected');
  }
  void teardownSession().then(scheduleReconnect);
}

function scheduleReconnect() {
  if (runtime.suppressReconnect) return;

  // A code is only valid for a while; after that the user needs a new one.
  if (Date.now() - runtime.issuedAt > SESSION_CONFIG.codeTtlMs) {
    setStatus('disconnected');
    if (app.role === 'laptop') {
      showInlineError('errors.codeExpired');
    } else {
      showScreen('connect');
      showInlineError('errors.codeExpired');
    }
    return;
  }

  const attempt = runtime.reconnectAttempts++;
  if (attempt >= 6) {
    setStatus('disconnected');
    showInlineError('errors.connectionFailed');
    return;
  }

  // Exponential backoff with a ceiling.
  const delay = Math.min(
    SESSION_CONFIG.reconnectMaxDelayMs,
    SESSION_CONFIG.reconnectBaseDelayMs * 2 ** attempt,
  );
  setStatus('connecting', t('conn.reconnecting'));
  runtime.reconnectTimer = setTimeout(() => {
    if (runtime.suppressReconnect) return;
    if (app.role === 'laptop') void hostListen();
    else void joinSession(runtime.code);
  }, delay);
}

function disconnect() {
  runtime.suppressReconnect = true;
  clearTimeout(runtime.reconnectTimer);
  runtime.reconnectAttempts = 0;
  hideVerify();
  hideNotice();
  void teardownSession().then(() => {
    setStatus('disconnected');
    app.emit('disconnected');
    runtime.suppressReconnect = false;
    if (app.role === 'phone') {
      showScreen('connect');
      return;
    }
    // The laptop keeps hosting: reuse the code while it is still valid,
    // otherwise show a fresh one straight away.
    if (Date.now() - runtime.issuedAt > SESSION_CONFIG.codeTtlMs) newCode();
    else void hostListen();
  });
}

/* ------------------------------------------------------------------ *
 * Environment checks
 * ------------------------------------------------------------------ */

function fatal(messageKey) {
  const node = document.createElement('div');
  node.className = 'fatal-banner';
  node.setAttribute('role', 'alert');
  node.textContent = t(messageKey);
  document.body.appendChild(node);
}

function checkEnvironment() {
  if (typeof window.RTCPeerConnection !== 'function') {
    fatal('errors.browserIncompatible');
    return false;
  }
  try {
    assertCryptoAvailable();
  } catch {
    fatal('errors.cryptoUnavailable');
    return false;
  }
  if (!window.isSecureContext) {
    fatal('errors.notSecure');
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Phone-side code input
 * ------------------------------------------------------------------ */

function bindPhoneInput() {
  const input = $('#code-input');
  const button = $('#connect-btn');
  if (!input || !button) return;

  input.addEventListener('input', () => {
    // Keep only digits and group them as the user types.
    const raw = normalizeCode(input.value).slice(0, SESSION_CONFIG.codeLength);
    input.value = formatCode(raw);
  });

  const submit = () => {
    const code = normalizeCode(input.value);
    if (code.length !== SESSION_CONFIG.codeLength) {
      showInlineError('errors.wrongOrExpiredCode');
      return;
    }
    void joinSession(code);
  };

  button.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function bindNav() {
  document.addEventListener('click', (event) => {
    const navButton = event.target.closest('[data-nav]');
    if (navButton) {
      showScreen(navButton.dataset.nav);
      return;
    }
    if (event.target.closest('#disconnect-btn, [data-disconnect]')) {
      disconnect();
      return;
    }
    if (event.target.closest('[data-action="new-code"]')) {
      newCode();
      return;
    }
    if (event.target.closest('[data-action="copy-code"]')) {
      copyCode();
      return;
    }
    if (event.target.closest('[data-notice-close]')) {
      hideNotice();
    }
  });
}

async function copyCode() {
  const code = runtime.code || '';
  try {
    await navigator.clipboard.writeText(code);
    toast(t('connect.copied'));
  } catch {
    // Clipboard API needs a secure context and permission; fall back to a
    // temporary selection the user can copy manually.
    const display = $('#code-display');
    if (display) {
      const range = document.createRange();
      range.selectNodeContents(display);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    toast(t('connect.copied'));
  }
}

app.toast = toast;
app.sendControl = (object) => (app.session ? app.session.sendControl(object) : false);
app.settings.on('change', (info) => {
  if (info.key === 'theme') applyTheme(info.value);
});

function boot() {
  // Theme and language first: everything else depends on them.
  applyTheme(app.settings.get('theme'));
  setLanguage(app.settings.language);
  translateDom();
  if (!checkEnvironment()) return;

  bindNav();
  $('[data-stats-toggle]')?.setAttribute('aria-expanded', 'false');

  // Features only ever see the shared session.
  app.camera = initCamera(app);
  initFiles(app);

  // Settings screen is built by the settings module.
  const host = $('[data-settings-host]');
  if (host) host.appendChild(mountSettings(app));

  if (app.role === 'phone') {
    bindPhoneInput();

    // Pre-fill from ?code= so the QR code works with any camera app.
    const params = new URLSearchParams(location.search);
    const fromUrl = normalizeCode(params.get('code'));
    const input = $('#code-input');
    if (fromUrl.length === SESSION_CONFIG.codeLength) {
      if (input) input.value = formatCode(fromUrl);
      void joinSession(fromUrl);
    } else {
      setStatus('disconnected');
      showScreen('connect');
    }
  } else {
    // The laptop owns the code and starts listening immediately.
    const hash = location.hash.replace('#', '');
    showScreen(['connect', 'camera', 'files', 'settings', 'help'].includes(hash) ? hash : 'connect');
    newCode();
  }

  window.addEventListener('beforeunload', () => {
    try {
      app.session?.close('unload');
    } catch {
      /* ignore */
    }
  });
}

// Language switching rebuilds the static text; dynamic strings are set with
// t() whenever they change, so nothing else is needed here.
app.applyLanguage = (language) => {
  setLanguage(language);
  translateDom();
};

app.onReset = () => {
  app.settings.forgetAll();
  hideNotice();
};

// Defaults; files.js overrides these when the File System Access API exists.
app.canPickFolder = () => false;
app.chooseSaveFolder = async () => null;

boot();
