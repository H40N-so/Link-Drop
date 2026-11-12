// The app shell: navigation, the pairing flow, verification and reconnection.
//
// This is the only module that knows which signaling adapter is in use. The
// camera and file modules just receive a connected RTCSession through the
// shared `app` object, which is why swapping the adapter changes nothing else.
//
// Both pages share this file: index.html runs the laptop role and phone.html
// runs the phone role. The two roles are kept apart on purpose — the laptop
// only ever shows the code and the QR code, never a link to the phone page.

import { SESSION_CONFIG, ENABLE_BACKUP_SIGNALING } from '../config.js';
import { RTCSession, Emitter } from './rtc.js';
import { createPeerJsSignaling, peerJsAvailable } from './signaling-peerjs.js';
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
import { openModal, alertDialog, toast as showToast, banner as showBanner } from './feedback.js';
import { ScreenRouter } from './router.js';
import { isDesktopClass, isPhoneClass } from './device.js';
import { QrScanner, extractCode } from './scanner.js';
import { mountConnectionCheck } from './checks.js';
import { mountIconSprite } from './icons.js';

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

/** Screen order per role. Used for direction-aware transitions. */
const LAPTOP_SCREENS = ['connect', 'camera', 'files', 'settings', 'help'];
const PHONE_SCREENS = ['landing', 'connecting', 'camera', 'files', 'settings', 'help'];

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
  joining: false,
  countdownTimer: null,
  statsTimer: null,
  reconnectTimer: null,
  bannerController: null,
  verifyModal: null,
  resolveHello: null,
  helloPromise: null,
  router: null,
  cells: null,
  scanner: null,
  connectPhase: null,
};

const $ = (selector) => document.querySelector(selector);

/* ------------------------------------------------------------------ *
 * Small UI helpers
 * ------------------------------------------------------------------ */

/** Map the app's short kinds onto the toast system's types. */
function toast(message, kind = 'info') {
  if (!message) return;
  const type = kind === 'warn' ? 'warning' : kind === 'error' ? 'error' : kind;
  showToast(message, { type, closeLabel: t('common.dismiss') });
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
  if (disconnect) {
    disconnect.hidden = !(status === 'connected' || status === 'waiting' || status === 'connecting');
  }
  const inline = $('[data-connect-detail]');
  if (inline) inline.textContent = detail || '';
  // The laptop's Connect card flips to its "connected" state once live.
  setLaptopConnectPhase(status === 'connected' ? 'connected' : 'pairing');
  if (status === 'disconnected') {
    app.peerName = '';
    updateDeviceName();
  }
}

function updateDeviceName() {
  const node = $('#device-name');
  if (node) {
    node.textContent = app.peerName || '';
    node.hidden = !app.peerName;
  }
  // The connected phone screen shows the laptop name in its status card.
  document.querySelectorAll('[data-phone-peer]').forEach((el) => {
    el.textContent = app.peerName || t('conn.device');
  });
}

/* ------------------------------------------------------------------ *
 * Screen routing + navigation
 * ------------------------------------------------------------------ */

function showScreen(name, options) {
  runtime.router?.show(name, options);
}

function onScreenChange(id) {
  document.body.dataset.screen = id;
  document.querySelectorAll('[data-nav]').forEach((button) => {
    const active = button.dataset.nav === id;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  moveNavIndicators();
  try {
    history.replaceState(null, '', '#' + id);
  } catch {
    /* ignore */
  }
}

/** Slide the sidebar / tab bar indicator under the active item. */
function moveNavIndicators() {
  const nav = $('.nav');
  const navActive = nav?.querySelector('.nav-item.is-active');
  const navIndicator = nav?.querySelector('.nav-indicator');
  if (nav && navIndicator) {
    if (navActive) {
      const nr = nav.getBoundingClientRect();
      const ar = navActive.getBoundingClientRect();
      navIndicator.style.width = ar.width + 'px';
      navIndicator.style.height = ar.height + 'px';
      navIndicator.style.transform = `translate3d(${Math.round(ar.left - nr.left)}px, ${Math.round(ar.top - nr.top)}px, 0)`;
      navIndicator.style.opacity = '1';
    } else {
      navIndicator.style.opacity = '0';
    }
  }

  const tabbar = $('.tabbar');
  const tabActive = tabbar?.querySelector('.nav-item.is-active');
  const tabIndicator = tabbar?.querySelector('.tab-indicator');
  if (tabbar && tabIndicator) {
    if (tabActive) {
      const tr = tabbar.getBoundingClientRect();
      const ar = tabActive.getBoundingClientRect();
      tabIndicator.style.width = ar.width + 'px';
      tabIndicator.style.transform = `translate3d(${Math.round(ar.left - tr.left)}px, 0, 0)`;
      tabIndicator.style.opacity = '1';
    } else {
      tabIndicator.style.opacity = '0';
    }
  }
}

/* ------------------------------------------------------------------ *
 * Phone-only screens
 * ------------------------------------------------------------------ */

function setPhoneDetail(text) {
  const node = $('#phone-connecting-detail');
  if (node) node.textContent = text;
}

function showLanding() {
  if (app.role !== 'phone') return;
  showScreen('landing');
}

function showConnecting() {
  if (app.role !== 'phone') return;
  setPhoneDetail(t('phone.connectingHint'));
  showScreen('connecting');
}

/* ------------------------------------------------------------------ *
 * Pairing code screen (laptop)
 * ------------------------------------------------------------------ */

function phonePageUrl(code) {
  // Build the phone URL from the current location so it works at a domain
  // root, under a sub-path and on localhost. Only the QR code uses this:
  // the laptop page never links to the phone page.
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
  if (!qrHost) return;
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
      qrHost.innerHTML = `<p class="muted small">${t('common.unsupported')}</p>`;
    }
  } catch {
    qrHost.innerHTML = `<p class="muted small">${t('common.unsupported')}</p>`;
  }
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
    setCodeProgress(0);
    if (runtime.status === 'waiting') {
      void teardownSession();
      setStatus('disconnected');
      showInlineError('errors.codeExpired');
    }
    return;
  }
  if (node) node.textContent = t('connect.expiresIn', { time: formatClock(remaining) });
  setCodeProgress(remaining / SESSION_CONFIG.codeTtlMs);
}

/** Drive the slim linear countdown under the pairing code. */
function setCodeProgress(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const fill = $('#code-progress');
  if (fill) fill.style.transform = `scaleX(${clamped})`;
  const bar = fill?.parentElement;
  if (bar) bar.classList.toggle('is-low', clamped < 0.25);
}

/** Highlight the active step of the 3-step pairing stepper (laptop). */
function setConnectStep(active) {
  const stepper = $('[data-stepper]');
  if (!stepper) return;
  stepper.querySelectorAll('.step').forEach((step) => {
    const n = Number(step.dataset.step);
    step.classList.toggle('is-active', n === active);
    step.classList.toggle('is-done', n < active);
  });
}

/** Fill the connected card with the peer's name and the friendly subtitle. */
function fillConnectedCard() {
  const connected = $('#connect-connected');
  if (!connected) return;
  const name = app.peerName || t('conn.device');
  connected.querySelectorAll('[data-connected-name]').forEach((n) => {
    n.textContent = name;
  });
  const sub = connected.querySelector('[data-connected-device]');
  if (sub) sub.textContent = t('connect.connectedSub', { name });
}

/** Swap the laptop Connect card between the pairing and connected states. */
function setLaptopConnectPhase(phase) {
  if (app.role !== 'laptop') return;
  const pairing = $('#connect-pairing');
  const connected = $('#connect-connected');
  if (!pairing || !connected) return;

  if (runtime.connectPhase == null) {
    runtime.connectPhase = connected.hidden ? 'pairing' : 'connected';
  }
  if (runtime.connectPhase === phase) return;

  if (phase === 'connected') fillConnectedCard();
  runtime.connectPhase = phase;

  const swap = () => {
    pairing.hidden = phase === 'connected';
    connected.hidden = phase !== 'connected';
  };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (typeof document.startViewTransition === 'function' && !reduced) {
    document.startViewTransition(swap);
  } else {
    swap();
  }
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

function errorNode() {
  return app.role === 'phone' ? $('#phone-landing-status') : $('#connect-status');
}

/**
 * Show a message on the connect/landing screen.
 *
 * `options.retry` additionally reveals the short hint and the retry button
 * that live inside the same block, which is what we want when the pairing
 * service itself is unreachable (as opposed to a wrong code).
 */
function showInlineError(key, { retry = false } = {}) {
  const node = errorNode();
  if (!node) return;
  const text = node.querySelector('[data-error-text]') || node;
  text.textContent = t(key);
  node.className = 'inline-status is-error';
  node.hidden = false;

  const hint = node.querySelector('[data-error-hint]');
  const retryBtn = node.querySelector('[data-action="retry-signaling"]');
  if (hint) {
    hint.hidden = !retry;
    hint.textContent = retry ? t('errors.signalingHint') : '';
  }
  if (retryBtn) retryBtn.hidden = !retry;
}

function hideInlineError() {
  const node = errorNode();
  if (node) node.hidden = true;
}

/** Retry the pairing service after an unreachable-signaling error. */
function retrySignaling() {
  hideInlineError();
  if (app.role === 'laptop') {
    if (runtime.code) void hostListen();
    else newCode();
    return;
  }
  const code = runtime.cells?.value() || runtime.code || '';
  if (code.length === SESSION_CONFIG.codeLength) {
    void startFromCode(code);
  } else {
    showLanding();
  }
}

/** A signaling outage is worth a retry button; a wrong code is not. */
function isSignalingError(key) {
  return (
    key === 'errors.signalingUnreachable' ||
    key === 'errors.signalingTimeout' ||
    key === 'errors.allServicesUnreachable'
  );
}

/** Camera problems deserve a dialog with the fix, not just a toast. */
function showCameraDialog(key) {
  const permission = key === 'errors.cameraDenied';
  try {
    alertDialog({
      title: t(permission ? 'camera.permission.title' : 'camera.nodevice.title'),
      description: t(key),
      body: `<p class="muted small">${t(
        permission ? 'camera.permission.hint' : 'camera.nodevice.hint',
      )}</p>`,
      okLabel: t('common.ok'),
      closeLabel: t('common.close'),
    });
  } catch {
    toast(t(key), 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Signaling adapters (A: PeerJS, and the optional MQTT backup)
 * ------------------------------------------------------------------ */

/**
 * The MQTT backup adapter and its library are only fetched when the backup is
 * enabled in config.js. While it is off, no MQTT code is loaded at all and the
 * runtime UI never mentions a backup service.
 */
let mqttModulePromise = null;

function loadMqttBackup() {
  if (!mqttModulePromise) {
    mqttModulePromise = loadVendorScript('vendor/mqtt.min.js')
      .then(() => import('./signaling-mqtt.js'))
      .catch((err) => {
        mqttModulePromise = null;
        throw err;
      });
  }
  return mqttModulePromise;
}

/** Load a vendored library on demand (relative to the page, like the tags). */
function loadVendorScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`failed to load ${src}`)), {
          once: true,
        });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function announceFallback() {
  app.emit('fallback');
  if (app.role === 'phone') {
    setPhoneDetail(t('phone.switchBackup'));
    toast(t('fallback.notice'), 'info');
  } else {
    showNotice(t('fallback.notice'));
  }
}

/**
 * Start signaling.
 *
 * By default the app pairs through PeerJS only. When `ENABLE_BACKUP_SIGNALING`
 * is true in config.js, a PeerJS failure additionally falls back to MQTT.
 * Resolves with a started adapter, or null if the attempt became stale.
 */
function startSignaling(code) {
  const epoch = runtime.epoch;
  // Signaling adapters speak in host/guest terms; the UI speaks laptop/phone.
  const signalRole = app.role === 'laptop' ? 'host' : 'guest';

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    /** Load and start the MQTT backup adapter (only when the flag is on). */
    const tryBackup = async () => {
      if (epoch !== runtime.epoch) {
        settle(resolve, null);
        return;
      }
      announceFallback();
      let mod;
      try {
        mod = await loadMqttBackup();
      } catch {
        settle(reject, { key: 'errors.allServicesUnreachable' });
        return;
      }
      if (settled || epoch !== runtime.epoch) return;
      if (!mod.mqttAvailable()) {
        settle(reject, { key: 'errors.allServicesUnreachable' });
        return;
      }
      runAdapter(mod.createMqttSignaling({ code, role: signalRole }), 'mqtt');
    };

    const runAdapter = (adapter, kind) => {
      // `done` is per adapter, so the PeerJS failure can still fall through to
      // a fresh MQTT attempt without being blocked by the first failure.
      let done = false;
      const fail = () => {
        if (done) return;
        done = true;
        adapter.close();
        if (kind === 'peerjs' && ENABLE_BACKUP_SIGNALING) {
          // PeerJS failed: visibly switch to the public backup service.
          void tryBackup();
        } else {
          settle(reject, {
            key: kind === 'peerjs' ? 'errors.signalingUnreachable' : 'errors.allServicesUnreachable',
          });
        }
      };

      adapter.on('ready', () => {
        done = true;
        settle(resolve, adapter);
      });
      adapter.on('fatal', (info) => {
        done = true;
        adapter.close();
        settle(reject, { key: info?.code || 'errors.connectionFailed' });
      });
      adapter.on('unreachable', fail);
      adapter.on('error', (info) => {
        if (!settled) console.warn('[linkdrop] signaling:', info?.code || info);
      });
      Promise.resolve(adapter.start()).catch(fail);
    };

    if (!peerJsAvailable()) {
      // The vendored PeerJS bundle is missing; without the backup there is
      // nothing left to try.
      if (ENABLE_BACKUP_SIGNALING) void tryBackup();
      else settle(reject, { key: 'errors.signalingUnreachable' });
      return;
    }

    runAdapter(createPeerJsSignaling({ code, role: signalRole }), 'peerjs');
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

  session.on('fallback', () => announceFallback());

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

  // The ~20 s watchdog: the two devices could not reach each other.
  session.on('timeout', (info) => {
    if (session !== runtime.session) return;
    showFatalConnectError(info?.code || 'errors.iceFailed');
  });

  session.on('error', (info) => {
    console.warn('[linkdrop] session:', info?.scope || '', info?.error || info);
  });
}

/** Guest role: publish the phone's camera and offer the connection. */
async function joinSession(input) {
  if (runtime.joining) return;
  const code = normalizeCode(input);
  if (code.length !== SESSION_CONFIG.codeLength) {
    if (app.role === 'phone') {
      showLanding();
      showInlineError('errors.wrongOrExpiredCode');
    } else {
      showInlineError('errors.wrongOrExpiredCode');
    }
    return;
  }

  runtime.joining = true;
  runtime.suppressReconnect = true;
  await teardownSession();
  runtime.suppressReconnect = false;

  runtime.code = code;
  runtime.issuedAt = Date.now();
  setStatus('connecting');
  hideInlineError();
  showConnecting();

  try {
    // The guest is the offerer, so the camera has to be ready first. This is
    // also the moment the browser shows its camera permission prompt.
    let stream;
    try {
      stream = await app.camera.ensureStream();
    } catch (err) {
      throw { key: err?.key || 'errors.cameraFailed' };
    }

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
    const key = err?.key || 'errors.connectionFailed';
    await teardownSession();
    setStatus('disconnected');
    if (app.role === 'phone') {
      showLanding();
      showInlineError(key, { retry: isSignalingError(key) });
    } else {
      showInlineError(key, { retry: isSignalingError(key) });
    }
    if (key === 'errors.cameraDenied' || key === 'errors.noCamera' || key === 'errors.cameraFailed') {
      showCameraDialog(key);
    } else {
      toast(t(key), 'error');
    }
  } finally {
    runtime.joining = false;
  }
}

/** Host role: announce the code and wait for one phone. */
async function hostListen() {
  if (!runtime.code) return;

  runtime.suppressReconnect = true;
  await teardownSession();
  runtime.suppressReconnect = false;

  if (!runtime.issuedAt) runtime.issuedAt = Date.now();
  setConnectStep(1);
  setStatus('waiting', t('connect.waiting'));
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
    const key = err?.key || 'errors.connectionFailed';
    showInlineError(key, { retry: isSignalingError(key) });
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
          showLanding();
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

  if (app.role === 'laptop') {
    setConnectStep(2);
    await hostVerify(session);
  } else {
    showGuestVerify();
  }
}

async function hostVerify(session) {
  const number = runtime.verifyNumber || '----';
  // Wait briefly for the phone's hello so we can show its name.
  const name =
    app.peerName ||
    (await Promise.race([
      runtime.helloPromise,
      new Promise((resolve) => setTimeout(() => resolve(t('conn.device')), 2000)),
    ])) ||
    t('conn.device');

  if (runtime.verifyNumber && app.settings.isTrusted(number, name)) {
    toast(t('verify.trusted'), 'info');
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
    /* If the channel is already gone the phone will simply time out. */
  }
  activateSession();
}

function activateSession() {
  const wasReconnecting = Boolean(runtime.bannerController);
  hideVerify();
  runtime.reconnectAttempts = 0;
  setConnectStep(3);
  setStatus('connected');
  startStatsPolling();
  app.emit('activated');
  // The laptop stays on Connect, which now shows the "connected" card; the
  // phone moves straight to its camera screen.
  if (app.role !== 'laptop') showScreen('camera');
  if (wasReconnecting) endReconnectBanner(t('conn.reconnected'));
}

/* ------------------------------------------------------------------ *
 * Verification dialog
 * ------------------------------------------------------------------ */

function buildVerifyBody(number, deviceLine, hintLine) {
  const body = document.createElement('div');
  body.className = 'verify-body';
  const code = document.createElement('div');
  code.className = 'verify-code';
  code.textContent = number;
  const device = document.createElement('p');
  device.className = 'verify-device';
  device.textContent = deviceLine;
  const hint = document.createElement('p');
  hint.className = 'verify-hint muted small';
  hint.textContent = hintLine;
  body.append(code, device, hint);
  return body;
}

function hideVerify() {
  const modal = runtime.verifyModal;
  runtime.verifyModal = null;
  try {
    modal?.close();
  } catch {
    /* ignore */
  }
}

function showHostVerify({ name, number, onAllow, onDeny }) {
  hideVerify();
  const body = buildVerifyBody(number, `${t('verify.device')}: ${name}`, t('verify.hint'));
  runtime.verifyModal = openModal({
    title: t('verify.acceptTitle'),
    body,
    dismissible: false,
    closeLabel: t('common.close'),
    actions: [
      {
        label: t('verify.reject'),
        variant: 'ghost',
        onClick: ({ close }) => {
          close();
          onDeny();
        },
      },
      {
        label: t('verify.accept'),
        variant: 'primary',
        onClick: ({ close }) => {
          close();
          onAllow();
        },
      },
    ],
  });
}

function showGuestVerify() {
  hideVerify();
  const name = app.peerName || t('conn.device');
  const body = buildVerifyBody(
    runtime.verifyNumber || '----',
    `${t('verify.device')}: ${name}`,
    t('verify.phoneCheck'),
  );
  const waiting = document.createElement('p');
  waiting.className = 'verify-waiting muted small';
  waiting.textContent = t('verify.waitingAccept');
  body.appendChild(waiting);
  runtime.verifyModal = openModal({
    title: t('verify.numberLabel'),
    body,
    dismissible: false,
  });
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

    const typeText = stats.connectionType
      ? stats.connectionType === 'relayed'
        ? t('conn.type.relayed')
        : t('conn.type.local')
      : '—';
    document.querySelectorAll('[data-conn-type]').forEach((node) => {
      node.textContent = typeText;
    });
    const latencyText = stats.rttMs != null ? `${stats.rttMs} ms` : '—';
    document.querySelectorAll('[data-conn-latency]').forEach((node) => {
      node.textContent = latencyText;
    });

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

function showReconnectBanner(message, type = 'warning') {
  if (runtime.bannerController) runtime.bannerController.update(message);
  else runtime.bannerController = showBanner(message, { type });
}

function endReconnectBanner(message) {
  const controller = runtime.bannerController;
  runtime.bannerController = null;
  if (!controller) return;
  if (message) {
    controller.update(message);
    setTimeout(() => controller.dismiss(), 2500);
  } else {
    controller.dismiss();
  }
}

function showFatalConnectError(key) {
  hideVerify();
  endReconnectBanner();
  runtime.suppressReconnect = true;
  void teardownSession().then(() => {
    runtime.suppressReconnect = false;
    setStatus('disconnected');
    if (app.role === 'phone') showLanding();
    showInlineError(key);
    toast(t(key), 'error');
  });
}

function handleLost() {
  if (runtime.suppressReconnect) return;
  if (runtime.status === 'connected') app.emit('disconnected');
  void teardownSession().then(scheduleReconnect);
}

function scheduleReconnect() {
  if (runtime.suppressReconnect) return;

  // A code is only valid for a while; after that the user needs a new one.
  if (Date.now() - runtime.issuedAt > SESSION_CONFIG.codeTtlMs) {
    setStatus('disconnected');
    endReconnectBanner();
    if (app.role === 'phone') showLanding();
    showInlineError('errors.codeExpired');
    return;
  }

  const attempt = runtime.reconnectAttempts++;
  if (attempt >= 6) {
    setStatus('disconnected');
    showReconnectBanner(t('conn.reconnectFailed'), 'error');
    if (app.role === 'phone') showLanding();
    showInlineError('errors.connectionFailed');
    return;
  }

  const delay = Math.min(
    SESSION_CONFIG.reconnectMaxDelayMs,
    SESSION_CONFIG.reconnectBaseDelayMs * 2 ** attempt,
  );
  setStatus('connecting', t('conn.reconnecting'));
  showReconnectBanner(t('conn.lost'));
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
  endReconnectBanner();
  void teardownSession().then(() => {
    setStatus('disconnected');
    app.emit('disconnected');
    runtime.suppressReconnect = false;
    if (app.role === 'phone') {
      showLanding();
      return;
    }
    // The laptop keeps hosting: reuse the code while it is still valid,
    // otherwise show a fresh one straight away.
    if (Date.now() - runtime.issuedAt > SESSION_CONFIG.codeTtlMs) newCode();
    else void hostListen();
  });
}

function cancelConnect() {
  runtime.joining = false;
  disconnect();
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
 * Phone: code entry cells, scanner and auto-connect
 * ------------------------------------------------------------------ */

function bindCodeCells(container, onComplete) {
  const cells = [...container.querySelectorAll('.code-cell')];
  if (!cells.length) return null;

  const value = () => cells.map((cell) => cell.value).join('');
  const focusIndex = (index) => {
    const bounded = Math.max(0, Math.min(cells.length - 1, index));
    cells[bounded]?.focus();
  };

  const fillFrom = (start, digits, notify = true) => {
    for (let k = 0; k < digits.length && start + k < cells.length; k++) {
      cells[start + k].value = digits[k];
    }
    focusIndex(start + digits.length);
    if (notify) maybeComplete();
  };

  const maybeComplete = () => {
    if (value().length === SESSION_CONFIG.codeLength) onComplete(value());
  };

  cells.forEach((cell, index) => {
    cell.addEventListener('input', () => {
      const digits = cell.value.replace(/\D/g, '');
      if (!digits) {
        cell.value = '';
        return;
      }
      if (digits.length > 1) {
        fillFrom(index, digits);
        return;
      }
      cell.value = digits[0];
      if (index < cells.length - 1) focusIndex(index + 1);
      maybeComplete();
    });

    cell.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !cell.value && index > 0) {
        event.preventDefault();
        cells[index - 1].value = '';
        focusIndex(index - 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusIndex(index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        focusIndex(index + 1);
      } else if (event.key === 'Enter') {
        maybeComplete();
      }
    });

    cell.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = (event.clipboardData?.getData('text') || '').replace(/\D/g, '');
      if (text) fillFrom(index, text);
    });

    cell.addEventListener('focus', () => cell.select());
  });

  return {
    value,
    focus: () => focusIndex(0),
    clear: () => {
      cells.forEach((cell) => {
        cell.value = '';
      });
      focusIndex(0);
    },
    fill: (digits) => {
      cells.forEach((cell) => {
        cell.value = '';
      });
      // A programmatic fill must not re-fire onComplete: startFromCode() calls
      // this after it already has the code, so notifying here would recurse.
      fillFrom(0, digits, false);
    },
  };
}

function readCodeFromUrl() {
  const params = new URLSearchParams(location.search);
  let raw = params.get('code');
  if (!raw && location.hash) {
    const match = /code=([0-9]+)/.exec(location.hash);
    if (match) raw = match[1];
  }
  return normalizeCode(raw);
}

function startFromCode(code) {
  const normalized = normalizeCode(code);
  if (normalized.length !== SESSION_CONFIG.codeLength) {
    showLanding();
    showInlineError('errors.wrongOrExpiredCode');
    return;
  }
  runtime.cells?.fill(normalized);
  void joinSession(normalized);
}

function scannerErrorKey(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'phone.scanDenied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'errors.noCamera';
  return 'errors.cameraFailed';
}

async function openScanner() {
  if (!QrScanner.supported) {
    toast(t('phone.scanUnsupported'), 'warn');
    return;
  }
  const overlay = $('#scanner');
  const video = $('#scanner-video');
  const message = $('#scanner-msg');
  if (!overlay || !video) return;

  overlay.hidden = false;
  document.documentElement.classList.add('ld-scroll-lock');
  if (message) message.textContent = t('phone.scanStarting');

  runtime.scanner = new QrScanner(video, {
    onResult: (text) => {
      const code = extractCode(text);
      closeScanner();
      if (!code) {
        toast(t('phone.scanInvalid'), 'warn');
        return;
      }
      startFromCode(code);
    },
  });

  try {
    await runtime.scanner.start();
    if (message) message.textContent = t('phone.scanHint');
  } catch (err) {
    closeScanner();
    toast(t(scannerErrorKey(err)), 'error');
  }
}

function closeScanner() {
  try {
    runtime.scanner?.stop();
  } catch {
    /* ignore */
  }
  runtime.scanner = null;
  const overlay = $('#scanner');
  if (overlay) overlay.hidden = true;
  document.documentElement.classList.remove('ld-scroll-lock');
}

/* ------------------------------------------------------------------ *
 * Connection check (Help)
 * ------------------------------------------------------------------ */

function mountChecks() {
  const host = $('[data-connection-check]');
  if (host) mountConnectionCheck(host);
}

/* ------------------------------------------------------------------ *
 * Boot helpers
 * ------------------------------------------------------------------ */

function refreshDynamicText() {
  renderCode();
  setStatus(runtime.status, $('[data-connect-detail]')?.textContent || '');
  if (runtime.connectPhase === 'connected') fillConnectedCard();
  mountChecks();
}

function fatalRoleMessage() {
  const shell = $('.phone-shell');
  const message = $('#role-message');
  if (shell) shell.hidden = true;
  if (message) message.hidden = false;
}

function redirectToPhone() {
  const base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
  const url = new URL(base + 'phone.html', location.href);
  url.search = location.search;
  url.hash = location.hash;
  location.replace(url.toString());
}

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
    if (event.target.closest('[data-action="retry-signaling"]')) {
      retrySignaling();
      return;
    }
    if (event.target.closest('[data-action="copy-code"]')) {
      copyCode();
      return;
    }
    if (event.target.closest('[data-action="scan"], [data-action="scan-close"]')) {
      closeScanner();
      if (event.target.closest('[data-action="scan"]')) openScanner();
      return;
    }
    if (event.target.closest('[data-action="cancel-connect"]')) {
      cancelConnect();
      return;
    }
    if (event.target.closest('[data-action="open-camera"]')) {
      showScreen('camera');
      return;
    }
    if (event.target.closest('[data-action="open-files"]')) {
      showScreen('files');
      return;
    }
    if (event.target.closest('[data-notice-close]')) {
      hideNotice();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && runtime.scanner) closeScanner();
  });

  window.addEventListener('resize', moveNavIndicators);
}

async function copyCode() {
  const code = runtime.code || '';
  try {
    await navigator.clipboard.writeText(code);
    toast(t('connect.copied'), 'success');
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
    toast(t('connect.copied'), 'success');
  }
}

/* ------------------------------------------------------------------ *
 * Role-specific boot
 * ------------------------------------------------------------------ */

function setupCommon() {
  runtime.router = new ScreenRouter({
    root: $('[data-screens]'),
    ids: app.role === 'phone' ? PHONE_SCREENS : LAPTOP_SCREENS,
    initial: app.role === 'phone' ? 'landing' : 'connect',
    scroller: app.role === 'phone' ? $('.phone-content') : $('.content'),
    onChange: onScreenChange,
  });
  moveNavIndicators();

  app.camera = initCamera(app);
  initFiles(app);

  const settingsHost = $('[data-settings-host]');
  if (settingsHost) settingsHost.appendChild(mountSettings(app));

  mountChecks();
  bindNav();
}

function bootLaptop() {
  setupCommon();
  const hash = location.hash.replace('#', '');
  if (LAPTOP_SCREENS.includes(hash) && hash !== 'connect') {
    showScreen(hash);
  } else {
    onScreenChange('connect');
  }
  newCode();
}

function bootPhone() {
  setupCommon();

  const cellsHost = $('[data-code-cells]');
  if (cellsHost) {
    runtime.cells = bindCodeCells(cellsHost, (code) => startFromCode(code));
  }

  $('[data-action="phone-connect"]')?.addEventListener('click', () => {
    const code = runtime.cells?.value() || '';
    if (code.length !== SESSION_CONFIG.codeLength) {
      showInlineError('errors.wrongOrExpiredCode');
      return;
    }
    startFromCode(code);
  });

  const fromUrl = readCodeFromUrl();
  if (fromUrl.length === SESSION_CONFIG.codeLength) {
    // ?code= in the URL: connect straight away, no extra tap.
    showConnecting();
    runtime.cells?.fill(fromUrl);
    void joinSession(fromUrl);
  } else {
    setStatus('disconnected');
    showLanding();
    setTimeout(() => runtime.cells?.focus(), 120);
  }
}

function boot() {
  // Inject the vendored icon sprite before anything renders.
  mountIconSprite();

  // Theme and language first: everything else depends on them.
  applyTheme(app.settings.get('theme'));
  setLanguage(app.settings.language);
  translateDom();

  // Role separation, before anything else starts.
  if (app.role === 'phone' && isDesktopClass()) {
    fatalRoleMessage();
    return;
  }
  if (app.role === 'laptop' && isPhoneClass()) {
    redirectToPhone();
    return;
  }

  if (!checkEnvironment()) return;

  if (app.role === 'phone') bootPhone();
  else bootLaptop();

  window.addEventListener('beforeunload', () => {
    try {
      app.session?.close('unload');
    } catch {
      /* ignore */
    }
  });
}

app.toast = toast;
app.showCameraError = showCameraDialog;
app.sendControl = (object) => (app.session ? app.session.sendControl(object) : false);
app.settings.on('change', (info) => {
  if (info.key === 'theme') applyTheme(info.value);
});

// Language switching rebuilds the static text; dynamic strings are set with
// t() whenever they change, so we refresh the few that live in the DOM.
app.applyLanguage = (language) => {
  setLanguage(language);
  translateDom();
  refreshDynamicText();
};

app.onReset = () => {
  app.settings.forgetAll();
  hideNotice();
};

// Defaults; files.js overrides these when the File System Access API exists.
app.canPickFolder = () => false;
app.chooseSaveFolder = async () => null;

boot();
