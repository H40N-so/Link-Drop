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

const PEER_ID_PREFIX = 'linkdrop-';

export class PeerJsSignaling extends SignalingBase {
  constructor(options) {
    super(options);
    this.peer = null;
    this.conn = null;
    this._timeout = null;
    this._established = false;
    this._ready = false;
  }

  _peerOptions() {
    return peerJsOptions();
  }

  async start() {
    // Give up (and let the app fall back to MQTT) if PeerJS does not come up
    // in time.
    this._timeout = setTimeout(() => {
      if (!this._ready) {
        this._fail('errors.signalingTimeout', 'The pairing service did not respond in time.');
        // Signal the caller explicitly: the UI uses this to switch adapters.
        this.emit('unreachable', { reason: 'timeout' });
      }
    }, PEERJS_CONFIG.timeoutMs);

    const options = {
      ...this._peerOptions(),
      debug: 0,
      config: { iceServers: ICE_SERVERS },
    };

    const id = this.role === 'host' ? PEER_ID_PREFIX + this.code : undefined;
    this.peer = new window.Peer(id, options);

    this.peer.on('open', () => {
      if (this.role === 'host') {
        this._ready = true;
        clearTimeout(this._timeout);
        this.emit('ready');
      } else {
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
    const conn = this.peer.connect(PEER_ID_PREFIX + this.code, { reliable: true });
    this._bindConnection(conn);
    conn.on('open', () => {
      this._ready = true;
      clearTimeout(this._timeout);
      this.emit('ready');
    });
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
    if (type === 'peer-unavailable') {
      this._fail('errors.wrongOrExpiredCode', 'No session found for that code.');
    } else if (type === 'unavailable-id') {
      this._fail('errors.codeInUse', 'That code is already in use. Generate a new one.');
    } else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      this._fail('errors.signalingUnreachable', 'Could not reach the pairing service.');
      this.emit('unreachable', { reason: type });
    } else if (type === 'browser-incompatible') {
      this._fail('errors.browserIncompatible', 'This browser does not support WebRTC.');
    } else {
      this._fail('errors.connectionFailed', 'Pairing failed.');
    }
    if (type === 'peer-unavailable') {
      // Wrong code is a user problem, not an outage: do not fall back.
      this.emit('fatal', { code: 'errors.wrongOrExpiredCode' });
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
