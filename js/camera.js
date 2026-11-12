// Camera feature: the phone publishes its camera, the laptop watches it.
//
// The phone side acquires the stream, keeps the screen awake and reacts to the
// remote controls the laptop sends over the control data channel.
// The laptop side renders the incoming video and offers snapshot, recording,
// fullscreen, mirror, picture-in-picture and a small live stats readout.

import { RESOLUTIONS } from './settings.js';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/** Build getUserMedia constraints from the current settings. */
function buildConstraints(settings) {
  const preset = RESOLUTIONS[settings.get('resolution')] || RESOLUTIONS['720p'];
  const facingMode = settings.get('defaultCamera') === 'front' ? 'user' : 'environment';
  return {
    video: {
      facingMode: { ideal: facingMode },
      // Ideal values mean the browser picks the closest supported mode rather
      // than failing outright on phones that cannot do exactly this.
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: settings.get('frameRate') },
    },
    audio: settings.get('audio')
      ? { echoCancellation: true, noiseSuppression: true }
      : false,
  };
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** Get the video element used as a PiP/recording source. */
function pickRecorderMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * @param {object} app shared app object
 * @returns {{ ensureStream: Function, stopStream: Function, handleControl: Function }}
 */
export function initCamera(app) {
  return app.role === 'phone' ? createPublisher(app) : createViewer(app);
}

/* ------------------------------------------------------------------ *
 * Phone side: publish the camera
 * ------------------------------------------------------------------ */

function createPublisher(app) {
  const { settings, t } = app;
  let stream = null;
  let wakeLock = null;
  let videoDeviceCount = 0;
  let currentFacing = settings.get('defaultCamera');

  const $ = (sel) => document.querySelector(sel);

  async function requestWakeLock() {
    if (!settings.get('keepAwake')) return;
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        // The lock is dropped whenever the page is hidden; re-acquire on return.
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      }
    } catch {
      app.toast(t('phone.wakeLockFailed'), 'warn');
    }
  }

  function releaseWakeLock() {
    try {
      wakeLock?.release();
    } catch {
      /* ignore */
    }
    wakeLock = null;
  }

  async function ensureStream() {
    if (stream) return stream;
    // Fail early with a friendly message instead of an exception mid-pairing.
    if (!navigator.mediaDevices?.getUserMedia) {
      throw { key: 'errors.cameraFailed' };
    }
    if (!window.isSecureContext) {
      throw { key: 'errors.notSecure' };
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia(buildConstraints(settings));
    } catch (err) {
      throw mapCameraError(err);
    }

    currentFacing = settings.get('defaultCamera');
    const video = $('[data-phone-preview]');
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      // Autoplay can still be rejected; the user already tapped, so ignore.
      video.play?.().catch(() => {});
    }

    await requestWakeLock();
    updateStatus();
    void reportCapabilities();

    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        // Camera stolen by another app or the device locked.
        app.emit('camera-stopped');
      });
    }
    return stream;
  }

  function stopStream() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    releaseWakeLock();
    updateStatus();
  }

  function updateStatus() {
    const status = $('[data-phone-status]');
    const detail = $('[data-phone-detail]');
    const startBtn = $('[data-phone-start]');
    const stopBtn = $('[data-phone-stop]');

    if (status) {
      status.textContent = stream
        ? t('phone.streaming', { name: app.peerName || '…' })
        : t('phone.notStreaming');
    }
    if (detail) {
      const facing = currentFacing === 'front' ? t('phone.front') : t('phone.back');
      const track = stream?.getVideoTracks?.()[0];
      const s = track?.getSettings?.() || {};
      const parts = [t('phone.currentCamera', { camera: facing })];
      if (s.width) parts.push(`${s.width}×${s.height}`);
      if (s.frameRate) parts.push(`${Math.round(s.frameRate)} fps`);
      detail.textContent = parts.join(' · ');
    }
    if (startBtn) startBtn.hidden = Boolean(stream);
    if (stopBtn) stopBtn.hidden = !stream;
  }

  /** Tell the laptop what this phone can do, so it can hide dead controls. */
  async function reportCapabilities() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDeviceCount = devices.filter((d) => d.kind === 'videoinput').length;
    } catch {
      videoDeviceCount = 1;
    }
    const track = stream?.getVideoTracks?.()[0];
    let torch = false;
    let maxFps = 0;
    try {
      const caps = track?.getCapabilities?.() || {};
      torch = Boolean(caps.torch);
      maxFps = caps.frameRate?.max ? Math.round(caps.frameRate.max) : 0;
    } catch {
      /* capabilities are optional */
    }
    app.sendControl({
      t: 'cam:caps',
      cameras: videoDeviceCount,
      torch,
      maxFps,
    });
  }

  /** Switch front/back by replacing the video track (no renegotiation). */
  async function switchCamera(facing) {
    currentFacing = facing;
    const next = await navigator.mediaDevices.getUserMedia(
      buildConstraints({ get: (k) => (k === 'defaultCamera' ? facing : settings.get(k)) }),
    );
    const newTrack = next.getVideoTracks()[0];
    const oldTrack = stream?.getVideoTracks?.()[0];
    await app.session?.replaceVideoTrack(newTrack);
    oldTrack?.stop();

    // Rebuild the local stream around the new video track, keeping audio.
    const audioTracks = stream?.getAudioTracks?.() ?? [];
    stream = new MediaStream([newTrack, ...audioTracks]);
    const video = $('[data-phone-preview]');
    if (video) video.srcObject = stream;
    updateStatus();
    void reportCapabilities();
    app.sendControl({ t: 'cam:state', camera: facing });
  }

  /** Apply resolution/frame-rate changes without renegotiating. */
  async function applyQuality({ resolution, frameRate }) {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    const preset = RESOLUTIONS[resolution] || RESOLUTIONS['720p'];
    try {
      await track.applyConstraints({
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: frameRate || settings.get('frameRate') },
      });
      app.sendControl({ t: 'cam:state', resolution, frameRate });
      updateStatus();
    } catch {
      app.toast(t('camera.controls.unsupported'), 'warn');
    }
  }

  async function setTorch(on) {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: Boolean(on) }] });
    } catch {
      app.toast(t('camera.controls.unsupported'), 'warn');
    }
  }

  async function setAudio(on) {
    if (on && !stream?.getAudioTracks?.().length) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = mic.getAudioTracks()[0];
        stream?.addTrack(track);
        await app.session?.setAudioTrack(track);
      } catch {
        app.toast(t('errors.cameraDenied'), 'error');
      }
    } else if (!on) {
      const track = stream?.getAudioTracks?.()[0];
      if (track) {
        await app.session?.setAudioTrack(null);
        track.stop();
        stream?.removeTrack(track);
      }
    }
  }

  /** Handle a control message from the laptop. */
  function handleControl(message) {
    switch (message?.t) {
      case 'cam:set':
        if (message.camera && message.camera !== currentFacing) switchCamera(message.camera);
        if (message.resolution || message.frameRate) {
          applyQuality({ resolution: message.resolution, frameRate: message.frameRate });
        }
        if (typeof message.torch === 'boolean') setTorch(message.torch);
        if (typeof message.audio === 'boolean') setAudio(message.audio);
        break;
      case 'cam:requestCaps':
        reportCapabilities();
        break;
      default:
        break;
    }
  }

  // Mirror the phone's state to the laptop whenever we (re)connect.
  app.on('activated', () => {
    updateStatus();
    reportCapabilities();
  });
  app.on('session', (session) => {
    if (session) updateStatus();
  });
  app.on('disconnected', () => {
    // Keep the camera warm so re-pairing is instant, but release the wake lock.
    releaseWakeLock();
  });

  // The phone's own Start/Stop buttons.
  $('[data-phone-start]')?.addEventListener('click', async () => {
    try {
      const next = await ensureStream();
      // If we are already connected, swap the outgoing track in place.
      const track = next.getVideoTracks()[0];
      if (track && app.session) await app.session.replaceVideoTrack(track);
    } catch (err) {
      app.toast(t(err?.key || 'errors.cameraFailed'), 'error');
    }
  });
  $('[data-phone-stop]')?.addEventListener('click', () => stopStream());

  // Re-acquire the wake lock when the tab becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && stream && settings.get('keepAwake')) {
      void requestWakeLock();
    }
  });

  return { ensureStream, stopStream, handleControl, isLive: () => Boolean(stream) };
}

function mapCameraError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { key: 'errors.cameraDenied' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { key: 'errors.noCamera' };
  return { key: 'errors.cameraFailed' };
}

/* ------------------------------------------------------------------ *
 * Laptop side: view and record
 * ------------------------------------------------------------------ */

function createViewer(app) {
  const { t } = app;
  const $ = (sel) => document.querySelector(sel);

  let stream = null;
  let recorder = null;
  let recordStartedAt = 0;
  let recordTimer = null;
  let mirrored = false;
  let caps = { cameras: 2, torch: false, maxFps: 60 };

  const video = () => $('[data-laptop-video]');

  function attach(session) {
    session.on('stream', (remote) => {
      stream = remote;
      const element = video();
      if (element && element.srcObject !== remote) {
        element.srcObject = remote;
        element.play?.().catch(() => {});
      }
      updateEmptyState();
      // Ask the phone what it can do now that we are connected.
      app.sendControl({ t: 'cam:requestCaps' });
    });
  }

  function updateEmptyState() {
    const empty = $('[data-camera-empty]');
    if (empty) empty.hidden = Boolean(stream);
  }

  /* ---- snapshot ---- */

  function snapshot() {
    const element = video();
    if (!element || !element.videoWidth) return;
    // Draw at the native camera resolution, ignoring the mirror transform.
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadBlob(blob, `linkdrop-${stamp}.png`);
      app.toast(t('camera.snapshotSaved'));
    }, 'image/png');
  }

  /* ---- recording ---- */

  function toggleRecording() {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    if (!stream || !window.MediaRecorder) {
      app.toast(t('common.unsupported'), 'warn');
      return;
    }
    const mimeType = pickRecorderMime();
    const parts = [];
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      app.toast(t('common.unsupported'), 'warn');
      return;
    }
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) parts.push(event.data);
    };
    recorder.onstop = () => {
      clearInterval(recordTimer);
      recordTimer = null;
      const blob = new Blob(parts, { type: mimeType || 'video/webm' });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadBlob(blob, `linkdrop-${stamp}.webm`);
      const badge = $('[data-record-badge]');
      if (badge) badge.hidden = true;
      const button = $('[data-action="record"]');
      if (button) button.textContent = t('camera.record');
      parts.length = 0; // release the chunks as soon as they are saved
    };
    // Timeslice keeps memory in check for long recordings.
    recorder.start(1000);
    recordStartedAt = performance.now();
    const badge = $('[data-record-badge]');
    if (badge) badge.hidden = false;
    const button = $('[data-action="record"]');
    if (button) button.textContent = t('camera.stopRecord');
    recordTimer = setInterval(() => {
      if (badge) badge.textContent = t('camera.recording', { time: formatDuration(performance.now() - recordStartedAt) });
    }, 500);
  }

  /* ---- view helpers ---- */

  function toggleMirror() {
    mirrored = !mirrored;
    const element = video();
    if (element) element.classList.toggle('is-mirrored', mirrored);
    $('[data-action="mirror"]')?.setAttribute('aria-pressed', String(mirrored));
  }

  async function toggleFullscreen() {
    const stage = $('[data-camera-stage]');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage?.requestFullscreen?.();
    } catch {
      app.toast(t('common.unsupported'), 'warn');
    }
  }

  async function togglePip() {
    const element = video();
    if (!element || !document.pictureInPictureEnabled) {
      app.toast(t('common.unsupported'), 'warn');
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await element.requestPictureInPicture();
    } catch {
      app.toast(t('common.unsupported'), 'warn');
    }
  }

  /* ---- remote controls ---- */

  function applyCapabilities(next) {
    caps = { ...caps, ...next };
    const torchRow = $('[data-control-row="torch"]');
    if (torchRow) torchRow.hidden = !caps.torch;
    // Disable 60 fps when the phone cannot do it.
    const sixty = document.querySelector('[data-fps="60"]');
    if (sixty) {
      sixty.disabled = caps.maxFps ? caps.maxFps < 60 : false;
      sixty.setAttribute('aria-disabled', String(Boolean(sixty.disabled)));
    }
    const cameraRow = $('[data-control-row="camera"]');
    if (cameraRow) cameraRow.hidden = (caps.cameras || 2) < 2;
  }

  function sendControl(partial) {
    app.sendControl({ t: 'cam:set', ...partial });
    // Reflect the choice locally so the segmented control updates instantly.
    const group = partial.camera
      ? 'camera'
      : partial.resolution
        ? 'resolution'
        : partial.frameRate
          ? 'frameRate'
          : null;
    if (group) markActive(`[data-control="${group}"]`, partial[group]);
    $('[data-action="torch"]')?.setAttribute('aria-pressed', String(Boolean(partial.torch)));
    $('[data-action="audio"]')?.setAttribute('aria-pressed', String(Boolean(partial.audio)));
  }

  function markActive(containerSelector, value) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    container.querySelectorAll('button').forEach((button) => {
      const active = button.dataset.value === String(value);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  /* ---- wiring ---- */

  function bindUi() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action], [data-control] button, [data-fps]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'snapshot') snapshot();
      else if (action === 'record') toggleRecording();
      else if (action === 'mirror') toggleMirror();
      else if (action === 'fullscreen') toggleFullscreen();
      else if (action === 'pip') togglePip();
      else if (action === 'torch') sendControl({ torch: button.getAttribute('aria-pressed') !== 'true' });
      else if (action === 'audio') sendControl({ audio: button.getAttribute('aria-pressed') !== 'true' });
    });

    document.querySelectorAll('[data-control]').forEach((container) => {
      container.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || !button.dataset.value) return;
        const key = container.dataset.control;
        const value = key === 'frameRate' ? Number(button.dataset.value) : button.dataset.value;
        sendControl({ [key]: value });
      });
    });

    $('[data-stats-toggle]')?.addEventListener('click', () => {
      const panel = $('[data-stats-panel]');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      const toggle = $('[data-stats-toggle]');
      toggle?.setAttribute('aria-expanded', String(!panel.hidden));
    });
  }

  bindUi();
  updateEmptyState();

  app.on('session', (session) => {
    if (session) {
      attach(session);
    } else {
      stream = null;
      updateEmptyState();
    }
  });
  app.on('control', (message) => {
    if (message?.t === 'cam:caps') applyCapabilities(message);
  });
  app.on('disconnected', () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream = null;
    updateEmptyState();
  });

  return { ensureStream: async () => null, stopStream: () => {}, handleControl: () => {} };
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
