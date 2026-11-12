// LinkDrop's shared WebRTC layer.
//
// EVERYTHING in the app talks to this class and nothing else. Neither the
// camera code nor the file code knows whether the setup messages travelled
// over PeerJS or over MQTT: they just get a connected session with one video
// track and two reliable data channels.
//
// Channels
//   control : small JSON messages (handshake, camera commands, file metadata)
//   files   : bulk file bytes, 64 KB chunks (see files.js)
//
// Roles
//   guest (the phone)  : creates the offer and the data channels
//   host  (the laptop) : answers
// Keeping a single offerer keeps negotiation simple and predictable.

import { ICE_SERVERS, RTC_CONFIG, SESSION_CONFIG, ICE_TRANSPORT_POLICY } from '../config.js';
import { connLog } from './log.js';
import { t } from './i18n.js';

/* ------------------------------------------------------------------ *
 * ICE transport policy
 * ------------------------------------------------------------------ */

// Starts at the value from config.js; the Connection check tool can flip it to
// 'relay' at runtime to test a TURN setup without editing the file.
let runtimeTransportPolicy = ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all';

/** Override the ICE transport policy for connections created from now on. */
export function setIceTransportPolicy(policy) {
  runtimeTransportPolicy = policy === 'relay' ? 'relay' : 'all';
}

/** The ICE transport policy new connections will use. */
export function getIceTransportPolicy() {
  return runtimeTransportPolicy;
}

/* ------------------------------------------------------------------ *
 * Tiny event emitter
 * ------------------------------------------------------------------ */

/**
 * Minimal event target used by the session and by the signaling adapters.
 * Both adapters expose the same events, which is what keeps the UI identical
 * whichever one is in use.
 */
export class Emitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        // A broken listener must never break the session.
        console.error(`[rtc] listener for "${event}" threw`, err);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The signaling adapter contract
 * ------------------------------------------------------------------ */

/**
 * Both signaling adapters extend this. The interface is intentionally small:
 *
 *   await adapter.start()        host: announce the code, guest: join it
 *   adapter.send(message)        send { type, ... } setup message to the peer
 *   adapter.close()              stop the signaling channel
 *
 * Events emitted (identical for both adapters):
 *   'ready'    signaling channel is usable
 *   'signal'   a setup message from the other device ({ type, sdp | candidate })
 *   'fallback' switched to the backup service
 *   'error'    { code, message } with a friendly, translatable message key
 *   'close'    signaling channel closed
 */
export class SignalingBase extends Emitter {
  constructor({ code, role }) {
    super();
    this.code = code;
    this.role = role; // 'host' | 'guest'
    this.closed = false;
  }

  // eslint-disable-next-line no-unused-vars
  async start() {
    throw new Error('start() must be implemented by the adapter');
  }

  // eslint-disable-next-line no-unused-vars
  send(_message) {
    throw new Error('send() must be implemented by the adapter');
  }

  close() {
    this.closed = true;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const FINGERPRINT_RE = /a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)/g;

/** Pull the first certificate fingerprint out of an SDP blob. */
function fingerprintFromSdp(sdp) {
  if (!sdp) return '';
  FINGERPRINT_RE.lastIndex = 0;
  const match = FINGERPRINT_RE.exec(sdp);
  return match ? `${match[1]} ${match[2]}` : '';
}

/**
 * Wait until ICE gathering has finished. Only used for in-band
 * renegotiation, where we cannot trickle candidates over the signaling
 * channel because it has already been closed.
 */
function waitForIceComplete(pc, timeoutMs = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    const timer = setTimeout(done, timeoutMs);
  });
}

/* ------------------------------------------------------------------ *
 * RTCSession
 * ------------------------------------------------------------------ */

export class RTCSession extends Emitter {
  /**
   * @param {object} options
   * @param {'host'|'guest'} options.role
   * @param {SignalingBase} options.signaling already started signaling adapter
   * @param {number} [options.maxBufferedAmount]
   */
  constructor({ role, signaling, maxBufferedAmount, chunkSize }) {
    super();
    this.role = role;
    this.signaling = signaling;
    this.maxBufferedAmount = maxBufferedAmount ?? RTC_CONFIG.maxBufferedAmount;
    this.chunkSize = chunkSize ?? RTC_CONFIG.chunkSize;

    this.pc = null;
    this.control = null;
    this.files = null;
    this.remoteStream = null;

    this._connected = false;
    this.closed = false;
    this._channelsOpen = 0;
    this._pendingCandidates = [];
    this._negotiating = false;
    this._renegotiating = false;
    // True while we have issued a local offer and await the answer. ICE
    // restarts re-offer, so this cannot be inferred from currentRemoteDescription.
    this._awaitingAnswer = false;

    // Connection watchdog + ICE recovery state.
    this._connectTimer = null;
    this._disconnectedTimer = null;
    this._iceRestarts = 0;
    this._timeoutFired = false;

    // Diagnostics for the live connection log: how many candidates of each
    // type we gathered, and whether we already reported the DTLS state.
    this._iceCounts = { host: 0, srflx: 0, prflx: 0, relay: 0 };
    this._iceGatheringLogged = false;
    this._dtlsLogged = false;

    // Rolling window used to compute the inbound video bitrate without
    // allocating on every sample.
    this._lastBytes = 0;
    this._lastBytesTs = 0;
    this._bitrateKbps = 0;

    this._onSignal = this._onSignal.bind(this);
    signaling.on('signal', this._onSignal);
    signaling.on('error', (err) => this.emit('signaling-error', err));
    signaling.on('fallback', (info) => this.emit('fallback', info));
    signaling.on('close', () => this.emit('signaling-close'));
  }

  /* ---------------------------------------------------------------- *
   * Setup
   * ---------------------------------------------------------------- */

  async start() {
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      // 'all' by default; the Connection check tool can force 'relay' to test
      // a TURN setup. Read from the runtime value so a flip takes effect for
      // connections created afterwards.
      iceTransportPolicy: runtimeTransportPolicy,
      // These two make WebRTC treat the link as a direct LAN connection when
      // possible, which improves the "local network" case.
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    this.remoteStream = new MediaStream();
    this._wirePeerConnection();

    if (this.role === 'guest') {
      // The guest owns the data channels and the offer.
      this.control = this.pc.createDataChannel('control', { ordered: true });
      this.files = this.pc.createDataChannel('files', { ordered: true });
      this._wireChannel(this.control, 'control');
      this._wireChannel(this.files, 'files');
    }
    // The host receives its channels through ondatachannel below.
  }

  _wirePeerConnection() {
    const pc = this.pc;

    pc.ontrack = (event) => {
      // The video (and optional audio) track from the other device.
      for (const track of event.streams?.[0]?.getTracks() ?? [event.track]) {
        if (!this.remoteStream.getTracks().some((t) => t.id === track.id)) {
          this.remoteStream.addTrack(track);
        }
      }
      this.emit('stream', this.remoteStream);
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'control') {
        this.control = channel;
        this._wireChannel(channel, 'control');
      } else if (channel.label === 'files') {
        this.files = channel;
        this._wireChannel(channel, 'files');
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      connLog.info(t('log.conn.state', { state }));
      this.emit('state', { state });
      if (state === 'connected') {
        this._connected = true;
        this._clearConnectTimer();
        this._flushCandidates();
        void this._logDtlsState();
      } else if (state === 'closed') {
        this._connected = false;
        this._clearWatchdogs();
        this.emit('lost', { state });
      } else if (state === 'failed' || state === 'disconnected') {
        this._connected = false;
        // Recovery is driven by the ICE connection state handler below; its
        // watchdog decides when a restart has failed for good.
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._logCandidate(event.candidate);
        this._sendSignal({ type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') this._logGatheringSummary();
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      connLog.info(t('log.ice.state', { state }));
      this.emit('ice-state', { state });
      if (state === 'failed') {
        this._clearDisconnectedTimer();
        this._attemptIceRestart('failed');
      } else if (state === 'disconnected') {
        // 'disconnected' is often transient (a Wi-Fi blip), so we wait a
        // moment before re-gathering candidates.
        this._armDisconnectedTimer('disconnected');
      } else if (state === 'connected' || state === 'completed') {
        this._clearDisconnectedTimer();
        this._iceRestarts = 0;
      }
    };
  }

  /** Count one gathered candidate by type and log the first one. */
  _logCandidate(candidate) {
    const type =
      candidate.type || /(?:typ\s+)(\w+)/.exec(candidate.candidate || '')?.[1] || 'host';
    if (type in this._iceCounts) this._iceCounts[type]++;
    if (this._iceCounts.host + this._iceCounts.srflx + this._iceCounts.prflx + this._iceCounts.relay === 1) {
      connLog.info(t('log.ice.gathering'));
    }
  }

  /** Report how many candidates of each type we gathered once discovery ends. */
  _logGatheringSummary() {
    if (this._iceGatheringLogged) return;
    this._iceGatheringLogged = true;
    const { host, srflx, relay } = this._iceCounts;
    connLog.ok(t('log.ice.candidates', { host, srflx, relay }));
  }

  /** Read the DTLS state from the transport stats (there is no event for it). */
  async _logDtlsState() {
    if (this._dtlsLogged) return;
    try {
      const stats = await this.pc.getStats();
      let dtls = null;
      stats.forEach((report) => {
        if (report.type === 'transport' && report.dtlsState) dtls = report.dtlsState;
      });
      if (dtls) {
        this._dtlsLogged = true;
        connLog.ok(t('log.dtls.state', { state: dtls }));
      }
    } catch {
      /* stats are best effort */
    }
  }

  _wireChannel(channel, name) {
    channel.binaryType = 'arraybuffer';
    // Backpressure: pause the sender once the buffer grows past the high water
    // mark and resume when it drains below the low mark. This is what keeps
    // memory flat for multi-gigabyte transfers.
    if (name === 'files') {
      channel.bufferedAmountLowThreshold = RTC_CONFIG.lowWaterMark;
    }

    let opened = false;
    const handleOpen = () => {
      // Guard against the two ways a channel can be open here: the 'open'
      // event firing after we attach, and the channel already being open when
      // it arrives through ondatachannel.
      if (opened) return;
      opened = true;
      this._channelsOpen++;
      connLog.ok(t('log.dc.open', { name }));
      if (this.control?.readyState === 'open' && this.files?.readyState === 'open') {
        // Both channels are up, so setup is finished. The signaling adapter can
        // now tear itself down: everything from here flows peer-to-peer.
        try {
          this.signaling.markEstablished?.();
        } catch {
          /* ignore */
        }
        this.emit('open');
      }
    };

    channel.onopen = handleOpen;
    // A channel received through ondatachannel can already be open, in which
    // case its 'open' event has already fired and would never reach us here.
    if (channel.readyState === 'open') handleOpen();

    channel.onclose = () => {
      this._channelsOpen = Math.max(0, this._channelsOpen - 1);
      this.emit('channel-close', { name });
    };

    channel.onerror = (event) => {
      this.emit('error', { scope: 'channel', name, error: event?.error ?? event });
    };

    channel.onmessage = (event) => {
      if (name === 'control') {
        let message;
        try {
          message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        } catch {
          return; // ignore malformed control frames
        }
        this._onControlMessage(message);
        this.emit('message', message);
      } else {
        this.emit('file-chunk', event.data);
      }
    };
  }

  /* ---------------------------------------------------------------- *
   * Negotiation
   * ---------------------------------------------------------------- */

  /** Guest only: create and send the initial offer. */
  async createOffer() {
    if (this.role !== 'guest') throw new Error('only the guest creates offers');
    this._negotiating = true;
    this._armConnectTimer();
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this._awaitingAnswer = true;
    this._sendSignal({ type: 'offer', sdp: this.pc.localDescription.sdp });
    connLog.ok(t('log.rtc.offerSent'));
    this._negotiating = false;
  }

  /** Host only: answer an incoming offer. */
  async handleOffer(sdp) {
    connLog.ok(t('log.rtc.offerReceived'));
    this._armConnectTimer();
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    // Candidates trickle in and may have arrived before the offer was applied;
    // now that there is a remote description they can finally be added.
    this._flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this._sendSignal({ type: 'answer', sdp: this.pc.localDescription.sdp });
    connLog.ok(t('log.rtc.answerSent'));
  }

  /** Guest only: handle the answer (initial or after an ICE restart). */
  async handleAnswer(sdp) {
    if (!this._awaitingAnswer) return;
    this._awaitingAnswer = false;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    this._flushCandidates();
    connLog.ok(t('log.rtc.answerReceived'));
  }

  async _onSignal(message) {
    if (!message || typeof message !== 'object') return;
    try {
      switch (message.type) {
        case 'offer':
          await this.handleOffer(message.sdp);
          break;
        case 'answer':
          await this.handleAnswer(message.sdp);
          break;
        case 'candidate':
          await this._addCandidate(message.candidate);
          break;
        default:
          break;
      }
    } catch (err) {
      this.emit('error', { scope: 'signal', error: err });
    }
  }

  async _addCandidate(candidate) {
    if (!candidate) return;
    // Candidates can arrive before the remote description is set.
    if (!this.pc.remoteDescription) {
      this._pendingCandidates.push(candidate);
      connLog.debug(t('log.ice.queued'));
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      this.emit('error', { scope: 'ice', error: err });
    }
  }

  _flushCandidates() {
    const pending = this._pendingCandidates;
    this._pendingCandidates = [];
    for (const candidate of pending) this._addCandidate(candidate);
  }

  /**
   * Route a setup message either through the signaling adapter (before the
   * peer connection exists) or in-band over the control channel (for
   * renegotiation, after the signaling channel has been closed).
   */
  _sendSignal(message) {
    if (this.control?.readyState === 'open') {
      this._sendControlRaw({ t: 'rtc:signal', message });
    } else if (!this.signaling.closed) {
      this.signaling.send(message);
    }
  }

  _onControlMessage(message) {
    if (message?.t === 'rtc:signal') {
      this._onSignal(message.message);
    } else if (message?.t === 'rtc:ice-restart' && this.role === 'guest') {
      // The host noticed the link is unhealthy and asks us (the offerer) to
      // re-gather candidates. One offerer keeps negotiation free of glare.
      this._attemptIceRestart('requested');
    }
  }

  /* ---------------------------------------------------------------- *
   * Connection watchdog + ICE recovery
   * ---------------------------------------------------------------- */

  _armConnectTimer() {
    if (this._connectTimer || this._connected) return;
    this._connectTimer = setTimeout(() => {
      this._connectTimer = null;
      if (this._connected || this.closed) return;
      this._timeoutFired = true;
      // The specific error the UI turns into the "ICE failed / TURN" notice.
      this.emit('timeout', { code: 'errors.iceFailed' });
      this.emit('error', { scope: 'timeout', code: 'errors.iceFailed' });
    }, SESSION_CONFIG.connectTimeoutMs);
  }

  _clearConnectTimer() {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
  }

  _armDisconnectedTimer(reason) {
    if (this._disconnectedTimer) return;
    this._disconnectedTimer = setTimeout(() => {
      this._disconnectedTimer = null;
      if (this._connected || this.closed) return;
      this._attemptIceRestart(reason);
    }, SESSION_CONFIG.disconnectedGraceMs);
  }

  _clearDisconnectedTimer() {
    if (this._disconnectedTimer) {
      clearTimeout(this._disconnectedTimer);
      this._disconnectedTimer = null;
    }
  }

  _clearWatchdogs() {
    this._clearConnectTimer();
    this._clearDisconnectedTimer();
  }

  /**
   * Re-gather ICE candidates without tearing the session down. The guest is
   * the only offerer, so a restart always originates here (or is requested by
   * the host over the control channel). Gives up after
   * SESSION_CONFIG.iceRestartMaxAttempts and reports the link as lost.
   */
  async _attemptIceRestart(reason) {
    if (this.closed || !this.pc || this.pc.connectionState === 'closed') return;
    if (this._iceRestarts >= SESSION_CONFIG.iceRestartMaxAttempts) {
      this._clearWatchdogs();
      this.emit('lost', { state: reason, reason: 'ice-restart-exhausted' });
      return;
    }
    this._iceRestarts++;
    this.emit('ice-restart', { attempt: this._iceRestarts, reason });
    connLog.warn(t('log.ice.restart', { n: this._iceRestarts }));

    if (this.role === 'guest') {
      try {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        this._awaitingAnswer = true;
        this._sendSignal({ type: 'offer', sdp: this.pc.localDescription.sdp });
      } catch (err) {
        this.emit('error', { scope: 'ice-restart', error: err });
      }
    } else {
      // Ask the guest to restart; if the channel is gone the guest will have
      // noticed the failure itself and restarted anyway.
      this._sendControlRaw({ t: 'rtc:ice-restart' });
    }
  }

  /* ---------------------------------------------------------------- *
   * Sending
   * ---------------------------------------------------------------- */

  _sendControlRaw(object) {
    if (this.control?.readyState === 'open') {
      this.control.send(JSON.stringify(object));
      return true;
    }
    return false;
  }

  /** Send a JSON control message. Returns false when the channel is closed. */
  sendControl(object) {
    return this._sendControlRaw(object);
  }

  /**
   * Write one chunk to the file channel, respecting backpressure.
   * Resolves when it is safe to send more.
   */
  async sendChunk(buffer) {
    const channel = this.files;
    if (!channel || channel.readyState !== 'open') {
      throw new Error('file channel is not open');
    }
    if (channel.bufferedAmount > this.maxBufferedAmount) {
      await new Promise((resolve) => {
        const onLow = () => {
          channel.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        channel.addEventListener('bufferedamountlow', onLow);
        // Safety net in case the event never fires (some engines are flaky
        // when the buffer drains exactly at the threshold).
        setTimeout(() => {
          channel.removeEventListener('bufferedamountlow', onLow);
          resolve();
        }, 1000);
      });
    }
    channel.send(buffer);
  }

  /** Largest payload the underlying SCTP association accepts. */
  get maxMessageSize() {
    const reported = this.pc?.sctp?.maxMessageSize;
    // Browsers report values a few hundred bytes larger than what is actually
    // safe, so we keep a small margin.
    const safe = reported ? reported - 1024 : 16384;
    return Math.max(1024, Math.min(this.chunkSize, safe));
  }

  /** Send the JSON header that precedes a file on the file channel. */
  sendFileMeta(object) {
    if (!this.files || this.files.readyState !== 'open') return false;
    this.files.send(JSON.stringify(object));
    return true;
  }

  /** Add every track of a local stream (used by the phone's camera). */
  addStream(stream) {
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }
  }

  /** Swap the outgoing video track without renegotiating. */
  async replaceVideoTrack(track) {
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(track);
    } else {
      this.pc.addTrack(track);
    }
  }

  hasAudioSender() {
    return this.pc.getSenders().some((s) => s.track && s.track.kind === 'audio');
  }

  /** Attach (or clear) the outgoing audio track, renegotiating if needed. */
  async setAudioTrack(track) {
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (sender) {
      await sender.replaceTrack(track);
      return;
    }
    if (track) {
      this.pc.addTrack(track);
      // Adding a track changes the negotiation: ask the guest to re-offer.
      if (this.role === 'guest') await this.renegotiate();
    }
  }

  get isConnected() {
    return this._connected;
  }

  /* ---------------------------------------------------------------- *
   * Renegotiation (used to switch the microphone on mid-session)
   * ---------------------------------------------------------------- */

  /** Guest only: trigger a renegotiation in-band over the control channel. */
  async renegotiate() {
    if (this.role !== 'guest') return;
    if (this._renegotiating) return;
    this._renegotiating = true;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await waitForIceComplete(this.pc);
      this._sendControlRaw({ t: 'rtc:signal', message: { type: 'offer', sdp: this.pc.localDescription.sdp } });
    } finally {
      this._renegotiating = false;
    }
  }

  /* ---------------------------------------------------------------- *
   * Verification and connection quality
   * ---------------------------------------------------------------- */

  /** Both DTLS certificate fingerprints, from getStats with an SDP fallback. */
  async getFingerprints() {
    try {
      const stats = await this.pc.getStats();
      let transport = null;
      const certs = new Map();
      stats.forEach((report) => {
        if (
          report.type === 'transport' &&
          (report.localCertificateId || report.remoteCertificateId)
        ) {
          transport = report;
        }
        if (report.type === 'certificate' && report.fingerprint) {
          certs.set(report.id, report.fingerprint);
        }
      });
      if (transport) {
        const local = certs.get(transport.localCertificateId);
        const remote = certs.get(transport.remoteCertificateId);
        if (local && remote) return { local, remote };
      }
    } catch {
      // fall through to the SDP based method
    }
    return {
      local: fingerprintFromSdp(this.pc.localDescription?.sdp),
      remote: fingerprintFromSdp(this.pc.remoteDescription?.sdp),
    };
  }

  /** Video resolution, fps, inbound bitrate and round-trip time. */
  async getStats() {
    const now = performance.now();
    let width = 0;
    let height = 0;
    let fps = 0;
    let bytes = 0;
    let rttMs = null;
    let connectionType = null;

    try {
      const stats = await this.pc.getStats();
      const candidates = new Map();
      let pair = null;

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          width = report.frameWidth || width;
          height = report.frameHeight || height;
          fps = report.framesPerSecond || fps;
          bytes = report.bytesReceived || bytes;
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidates.set(report.id, report);
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (!pair || report.nominated) pair = report;
        }
      });

      if (pair) {
        if (typeof pair.currentRoundTripTime === 'number') {
          rttMs = Math.round(pair.currentRoundTripTime * 1000);
        }
        const local = candidates.get(pair.localCandidateId);
        const remote = candidates.get(pair.remoteCandidateId);
        const relayed =
          local?.candidateType === 'relay' || remote?.candidateType === 'relay';
        connectionType = relayed ? 'relayed' : 'direct';
      }
    } catch {
      // Stats are best effort; never let them break the UI.
    }

    // Bitrate from the delta between two samples.
    if (this._lastBytesTs) {
      const dt = (now - this._lastBytesTs) / 1000;
      if (dt > 0.2) {
        this._bitrateKbps = Math.max(0, Math.round(((bytes - this._lastBytes) * 8) / dt / 1000));
        this._lastBytes = bytes;
        this._lastBytesTs = now;
      }
    } else {
      this._lastBytes = bytes;
      this._lastBytesTs = now;
    }

    return { width, height, fps, bitrateKbps: this._bitrateKbps, rttMs, connectionType };
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  close(reason = 'user') {
    this._clearWatchdogs();
    try {
      this.control?.close();
      this.files?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    try {
      this.signaling.close();
    } catch {
      /* ignore */
    }
    this._connected = false;
    this.closed = true;
    this.emit('close', { reason });
  }
}

/** Number of milliseconds a code stays valid, exposed for the UI. */
export const CODE_TTL_MS = SESSION_CONFIG.codeTtlMs;
