// Signaling adapter A: PeerJS Cloud (the default).
//
// PeerJS gives us a tiny reliable data connection to the other device that we
// use for ONE thing only: carrying the offer, the answer and the ICE
// candidates of the real RTCPeerConnection. As soon as that connection is up
// we close PeerJS and everything flows directly between the two devices.
//
// The laptop (host) registers itself under a predictable id derived from the
// pairing code. The phone (guest) connects to that id.

import { PEERJS_CONFIG, ICE_SERVERS } from '../config.js';
import { SignalingBase } from './rtc.js';
import { connLog } from './log.js';
import { t } from './i18n.js';

const PEER_ID_PREFIX = 'linkdrop-';

// How often, and for how long, the phone keeps retrying to reach a host that
// PeerJS reports as unavailable. The laptop may still be registering its code.
const HOST_RETRY_INTERVAL_MS = 1500;
const HOST_RETRY_WINDOW_MS = 12000;

/* ------------------------------------------------------------------ *
 * PeerJS debug capture
 * ------------------------------------------------------------------ */

// PeerJS writes its own diagnostics with console.log/warn/error. To surface
// them in the "Connection details" panel we wrap those methods while a Peer is
// alive, route the lines into the shared log and restore the originals after.
// Our own console warnings (prefixed [linkdrop] / [rtc]) pass through
// untouched so they never appear twice.
//
// TURN credentials must never reach the log, so any configured username or
// credential that shows up in a captured line is replaced by a placeholder.
const REDACTIONS = ICE_SERVERS.flatMap((server) => [server.username, server.credential])
  .filter((value) => typeof value === 'string' && value.length >= 4)
  .map((value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));

function redact(line) {
  let out = line;
  for (const pattern of REDACTIONS) out = out.replace(pattern, '•••');
  return out;
}

let consoleCaptureCount = 0;
let consoleOriginals = null;

function beginConsoleCapture() {
  if (consoleCaptureCount++ > 0) return;
  consoleOriginals = { log: console.log, warn: console.warn, error: console.error };
  const route = (original, args) => {
    try {
      const line = args
        .map((a) => {
          if (typeof a === 'string') return a;
          if (a instanceof Error) return a.message;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
      if (!line) return;
      if (line.includes('[linkdrop]') || line.includes('[rtc]')) {
        original.apply(console, args);
        return;
      }
      connLog.debug(t('log.peerjs', { message: redact(line) }));
    } catch {
      /* logging must never break pairing */
    }
  };
  console.log = (...args) => route(consoleOriginals.log, args);
  console.warn = (...args) => route(consoleOriginals.warn, args);
  console.error = (...args) => route(consoleOriginals.error, args);
}

function endConsoleCapture() {
  if (consoleCaptureCount === 0) return;
  consoleCaptureCount--;
  if (consoleCaptureCount > 0 || !consoleOriginals) return;
  console.log = consoleOriginals.log;
  console.warn = consoleOriginals.warn;
  console.error = consoleOriginals.error;
  consoleOriginals = null;
}

export class PeerJsSignaling extends SignalingBase {
  constructor(options) {
    super(options);
    this.peer = null;
    this.conn = null;
    this._timeout = null;
    this._hostLookupTimer = null;
    this._retryTimer = null;
    this._retryStartedAt = 0;
    this._retryCount = 0;
    this._established = false;
    this._ready = false;
    this._capturing = false;
  }

  _peerOptions() {
    return peerJsOptions();
  }

  async start() {
    // Give up (and let the app fall back to MQTT) if PeerJS does not come up
    // in time.
    this._timeout = setTimeout(() => {
      if (!this._ready) {
        connLog.fail(t('log.signaling.timeout'));
        this._fail('errors.signalingTimeout', 'The pairing service did not respond in time.');
        // Signal the caller explicitly: the UI uses this to switch adapters.
        this.emit('unreachable', { reason: 'timeout' });
      }
    }, PEERJS_CONFIG.timeoutMs);

    const options = {
      ...this._peerOptions(),
      // Level 3 makes PeerJS emit its full diagnostics, which we capture into
      // the Connection-details panel below.
      debug: 3,
      config: { iceServers: ICE_SERVERS },
    };

    connLog.info(t('log.signaling.connecting', { host: peerJsHostLabel() }));
    beginConsoleCapture();
    this._capturing = true;
    const id = this.role === 'host' ? PEER_ID_PREFIX + this.code : undefined;
    this.peer = new window.Peer(id, options);

    this.peer.on('open', (openId) => {
      // The signaling server is up for both roles as soon as this fires.
      clearTimeout(this._timeout);
      this._timeout = null;
      connLog.ok(t('log.signaling.connected'));
      if (this.role === 'host') {
        this._ready = true;
        connLog.ok(t('log.signaling.hostRegistered', { id: openId || id }));
        this.emit('ready');
      } else {
        // We reached the server; now wait for the host to answer, retrying if
        // its code is not registered yet.
        this._armHostLookup();
        this._connectToHost();
      }
    });

    this.peer.on('connection', (conn) => {
      if (this.role !== 'host') return;
      // Only one phone at a time.
      if (this.conn && this.conn.open) {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
        return;
      }
      this._bindConnection(conn);
    });

    this.peer.on('error', (err) => this._handlePeerError(err));
  }

  _connectToHost() {
    const id = PEER_ID_PREFIX + this.code;
    connLog.info(t('log.signaling.lookup', { id }));
    let conn;
    try {
      conn = this.peer.connect(id, { reliable: true });
    } catch (err) {
      this._handlePeerError(err);
      return;
    }
    this._bindConnection(conn);
    conn.on('open', () => {
      if (this._ready) return;
      this._ready = true;
      clearTimeout(this._timeout);
      clearTimeout(this._hostLookupTimer);
      this._hostLookupTimer = null;
      connLog.ok(t('log.signaling.connOpen'));
      this.emit('ready');
    });
  }

  /** Give up on the host after HOST_RETRY_WINDOW_MS of failed lookups. */
  _armHostLookup() {
    if (this._hostLookupTimer) return;
    this._hostLookupTimer = setTimeout(() => {
      this._hostLookupTimer = null;
      if (this._ready || this.closed) return;
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      connLog.fail(t('log.signaling.notFound'));
      this._fail('errors.wrongOrExpiredCode', 'No session found for that code.');
      this.emit('fatal', { code: 'errors.wrongOrExpiredCode' });
    }, HOST_RETRY_WINDOW_MS);
  }

  /**
   * The host is not registered yet (typically the laptop is still preparing).
   * Retry every HOST_RETRY_INTERVAL_MS until the host lookup window expires.
   */
  _scheduleHostRetry() {
    if (this.closed || this._ready) return;
    if (!this._retryStartedAt) this._retryStartedAt = Date.now();
    if (Date.now() - this._retryStartedAt >= HOST_RETRY_WINDOW_MS) {
      connLog.fail(t('log.signaling.notFound'));
      this._fail('errors.wrongOrExpiredCode', 'No session found for that code.');
      this.emit('fatal', { code: 'errors.wrongOrExpiredCode' });
      return;
    }
    if (this._retryTimer) return;
    this._retryCount++;
    connLog.warn(t('log.signaling.retry', { n: this._retryCount }));
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (this.closed || this._ready) return;
      try {
        this.conn?.close();
      } catch {
        /* ignore */
      }
      this._connectToHost();
    }, HOST_RETRY_INTERVAL_MS);
  }

  _bindConnection(conn) {
    this.conn = conn;
    conn.on('data', (data) => {
      if (this._established) return; // ignore anything after pairing
      this.emit('signal', data);
    });
    conn.on('error', (err) => {
      this.emit('error', this._friendly(err));
    });
    conn.on('close', () => {
      // Normal after pairing: the channel is closed once WebRTC is up.
      if (!this._established) this.emit('close');
    });
  }

  _handlePeerError(err) {
    const type = err?.type || '';
    if (type) connLog.debug(t('log.signaling.error', { type }));
    if (type === 'peer-unavailable') {
      if (this.role === 'guest' && !this._established) {
        // The host may still be registering the code (the laptop shows
        // "Preparing…" until then), so retry before declaring the code wrong.
        this._scheduleHostRetry();
        return;
      }
      this._fail('errors.wrongOrExpiredCode', 'No session found for that code.');
      // Wrong code is a user problem, not an outage: do not fall back.
      this.emit('fatal', { code: 'errors.wrongOrExpiredCode' });
    } else if (type === 'unavailable-id') {
      this._fail('errors.codeInUse', 'That code is already in use. Generate a new one.');
    } else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      connLog.fail(t('log.signaling.error', { type }));
      this._fail('errors.signalingUnreachable', 'Could not reach the pairing service.');
      this.emit('unreachable', { reason: type });
    } else if (type === 'browser-incompatible') {
      this._fail('errors.browserIncompatible', 'This browser does not support WebRTC.');
    } else {
      this._fail('errors.connectionFailed', 'Pairing failed.');
    }
  }

  _friendly(err) {
    return err?.type === 'peer-unavailable'
      ? { code: 'errors.wrongOrExpiredCode' }
      : { code: 'errors.connectionFailed', error: err };
  }

  _fail(messageKey, fallback) {
    this.emit('error', { code: messageKey, message: fallback });
  }

  send(message) {
    if (this._established) return;
    try {
      if (this.conn?.open) this.conn.send(message);
    } catch (err) {
      this.emit('error', { code: 'errors.connectionFailed', error: err });
    }
  }

  /** Called by the session once the peer-to-peer link is up. */
  markEstablished() {
    this._established = true;
    clearTimeout(this._timeout);
    // The PeerJS connection has done its job; drop it.
    try {
      this.conn?.close();
    } catch {
      /* ignore */
    }
    this.close();
  }

  close() {
    this.closed = true;
    clearTimeout(this._timeout);
    clearTimeout(this._hostLookupTimer);
    clearTimeout(this._retryTimer);
    this._hostLookupTimer = null;
    this._retryTimer = null;
    if (this._capturing) {
      this._capturing = false;
      endConsoleCapture();
    }
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    this.conn = null;
  }
}

/** Factory used by the app shell. */
export function createPeerJsSignaling(options) {
  return new PeerJsSignaling(options);
}

/** PeerJS connection options, shared with the Connection check tool. */
export function peerJsOptions() {
  if (PEERJS_CONFIG.useCloud) {
    // PeerJS Cloud defaults; listed explicitly so they are easy to change.
    return { host: '0.peerjs.com', port: 443, path: '/', key: 'peerjs', secure: true };
  }
  return {
    host: PEERJS_CONFIG.host,
    port: PEERJS_CONFIG.port,
    path: PEERJS_CONFIG.path,
    key: PEERJS_CONFIG.key,
    secure: PEERJS_CONFIG.secure,
  };
}

/** Host of the active PeerJS server, for display in the Connection check. */
export function peerJsHostLabel() {
  const opts = peerJsOptions();
  return `${opts.host}${opts.port && opts.port !== 443 ? `:${opts.port}` : ''}`;
}

/** True when the PeerJS bundle was actually loaded from /vendor. */
export function peerJsAvailable() {
  return typeof window !== 'undefined' && typeof window.Peer === 'function';
}
