// File transfer in both directions.
//
// Bulk bytes travel on the dedicated `files` data channel in chunks of up to
// 64 KB. The sender pauses whenever the channel buffer grows past a high water
// mark, so a multi-gigabyte file never has to fit in memory on the sending
// side. The receiver either streams straight to disk (File System Access API)
// or assembles the chunks into a Blob at the end.
//
// One transfer at a time keeps the protocol trivial: a JSON metadata header,
// then exactly `size` bytes of chunks, then the next file.

import { t } from './i18n.js';

const META_KIND = 'meta';
const DIR_DB = 'linkdrop';
const DIR_STORE = 'handles';
const DIR_KEY = 'save-directory';

/* ------------------------------------------------------------------ *
 * IndexedDB helpers (only used to remember the chosen save folder)
 * ------------------------------------------------------------------ */

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIR_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DIR_STORE)) {
        request.result.createObjectStore(DIR_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIR_STORE, 'readwrite');
    tx.objectStore(DIR_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIR_STORE, 'readonly');
    const request = tx.objectStore(DIR_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ------------------------------------------------------------------ *
 * Small formatting helpers
 * ------------------------------------------------------------------ */

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function formatEta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const total = Math.ceil(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function safeName(name) {
  // Never trust a filename from the network.
  return String(name || 'file').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 180) || 'file';
}

function randomId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * @param {object} app shared app object
 * @returns {{ chooseSaveFolder: Function }}
 */
export function initFiles(app) {
  const $ = (sel) => document.querySelector(sel);

  /** Session history for this browser tab. */
  const transfers = [];
  const queue = [];
  let currentSend = null;
  let currentReceive = null;
  let dirHandle = null;
  let tickTimer = null;
  let uiDirty = true;

  /* ---- save folder -------------------------------------------------- */

  const canPickFolder = () =>
    typeof window.showDirectoryPicker === 'function' && app.settings.get('saveToDisk');

  async function chooseSaveFolder() {
    if (!canPickFolder()) {
      app.toast(app.t('files.folderUnsupported'), 'warn');
      return null;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandle = handle;
      await idbPut(DIR_KEY, handle).catch(() => {});
      app.toast(app.t('files.folderSet', { name: handle.name }));
      return handle;
    } catch {
      return null; // user cancelled
    }
  }

  async function restoreSaveFolder() {
    if (!app.settings.get('saveToDisk')) return;
    try {
      const handle = await idbGet(DIR_KEY);
      if (!handle) return;
      const permission = await handle.queryPermission?.({ mode: 'readwrite' });
      if (permission === 'granted') dirHandle = handle;
    } catch {
      /* no folder remembered */
    }
  }

  async function writableFor(name) {
    if (!dirHandle) return null;
    const permission = await dirHandle.queryPermission?.({ mode: 'readwrite' });
    if (permission !== 'granted') return null;

    // Never overwrite an existing file: pick "name (1).ext" instead.
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 0; i < 500; i++) {
      const candidate = i === 0 ? name : `${base} (${i})${ext}`;
      try {
        await dirHandle.getFileHandle(candidate); // exists -> try the next one
      } catch {
        const fileHandle = await dirHandle.getFileHandle(candidate, { create: true });
        return { writable: await fileHandle.createWritable(), name: candidate };
      }
    }
    return null;
  }

  /* ---- records ------------------------------------------------------ */

  function addRecord(partial) {
    const record = {
      id: randomId(),
      name: 'file',
      size: 0,
      mime: '',
      direction: 'to-laptop',
      status: 'queued',
      transferred: 0,
      speed: 0,
      eta: Infinity,
      error: '',
      file: null,
      parts: null,
      writable: null,
      cancelled: false,
      fingerprint: '',
      _lastBytes: 0,
      _lastTs: 0,
      ...partial,
    };
    record.fingerprint = record.id + ':' + record.name + ':' + record.size;
    transfers.unshift(record);
    uiDirty = true;
    render();
    return record;
  }

  function findById(id) {
    return transfers.find((r) => r.id === id) || null;
  }

  /* ---- sending ------------------------------------------------------ */

  function enqueue(files) {
    if (!files || !files.length) return;
    if (!app.session) {
      app.toast(app.t('errors.connectionFailed'), 'error');
      return;
    }
    for (const file of files) {
      const record = addRecord({
        name: safeName(file.name),
        size: file.size,
        mime: file.type || 'application/octet-stream',
        direction: app.role === 'phone' ? 'to-laptop' : 'to-phone',
        status: 'queued',
        file,
      });
      queue.push(record);
    }
    pump();
  }

  function pump() {
    if (currentSend) return;
    const next = queue.shift();
    if (!next) return;
    currentSend = next;
    void transfer(next).finally(() => {
      currentSend = null;
      pump();
    });
  }

  async function transfer(record) {
    const session = app.session;
    if (!session || !session.isConnected) {
      record.status = 'failed';
      record.error = app.t('errors.connectionFailed');
      uiDirty = true;
      return;
    }

    record.status = 'sending';
    record.transferred = 0;
    record.cancelled = false;
    record._lastBytes = 0;
    record._lastTs = performance.now();
    uiDirty = true;

    const chunkSize = session.maxMessageSize;
    const accepted = session.sendFileMeta({
      k: META_KIND,
      id: record.id,
      name: record.name,
      size: record.size,
      mime: record.mime,
    });
    if (!accepted) {
      record.status = 'failed';
      record.error = app.t('errors.channelClosed');
      uiDirty = true;
      return;
    }

    try {
      let offset = 0;
      while (offset < record.size) {
        if (record.cancelled || !session.isConnected) break;
        const slice = record.file.slice(offset, offset + chunkSize);
        // arrayBuffer() is the cheapest thing to hand to RTCDataChannel.
        const buffer = await slice.arrayBuffer();
        await session.sendChunk(buffer);
        offset += buffer.byteLength;
        record.transferred = offset;
        uiDirty = true;
      }
      if (record.cancelled) {
        record.status = 'cancelled';
        app.sendControl({ t: 'file:cancel', id: record.id });
      } else if (!session.isConnected) {
        record.status = 'failed';
        record.error = app.t('errors.channelClosed');
      } else {
        record.status = 'done';
        record.transferred = record.size;
        record.file = null; // let the File object go
      }
    } catch (err) {
      record.status = 'failed';
      record.error = err?.message || app.t('errors.channelClosed');
    }
    uiDirty = true;
    render();
  }

  function cancel(record) {
    if (record.status === 'done' || record.status === 'failed') return;
    record.cancelled = true;
    if (record.writable) {
      // Receiver side: close what we have so far.
      try {
        record.writable.abort?.();
      } catch {
        /* ignore */
      }
    }
    record.status = 'cancelled';
    uiDirty = true;
    render();
  }

  function retry(record) {
    if (record.direction === (app.role === 'phone' ? 'to-laptop' : 'to-phone')) {
      if (!record.file) {
        app.toast(app.t('files.note'), 'warn');
        return;
      }
      record.status = 'queued';
      record.cancelled = false;
      record.transferred = 0;
      queue.push(record);
      uiDirty = true;
      render();
      pump();
    }
  }

  /* ---- receiving ---------------------------------------------------- */

  async function beginReceive(meta) {
    const name = safeName(meta.name);
    const record = addRecord({
      id: meta.id || randomId(),
      name,
      size: Number(meta.size) || 0,
      mime: meta.mime || 'application/octet-stream',
      direction: app.role === 'phone' ? 'to-phone' : 'to-laptop',
      status: 'receiving',
    });

    if (app.settings.get('saveToDisk')) {
      const sink = await writableFor(name).catch(() => null);
      if (sink) {
        record.writable = sink.writable;
        record.name = sink.name;
      }
    }
    if (!record.writable) {
      // Fallback: keep the chunks and build a Blob at the end.
      record.parts = [];
    }

    record._lastTs = performance.now();
    record._lastBytes = 0;
    currentReceive = record;
    uiDirty = true;
    render();
  }

  async function onChunk(buffer) {
    const record = currentReceive;
    if (!record) return;
    const bytes = buffer.byteLength ?? buffer.size ?? 0;
    try {
      if (record.writable) {
        // Streaming write: memory stays flat no matter how big the file is.
        await record.writable.write(buffer);
      } else {
        record.parts.push(buffer);
      }
    } catch (err) {
      record.status = 'failed';
      record.error = err?.message || app.t('errors.generic');
      currentReceive = null;
      uiDirty = true;
      render();
      return;
    }
    record.transferred += bytes;
    uiDirty = true;

    if (record.size && record.transferred >= record.size) {
      await finishReceive(record);
    }
  }

  async function finishReceive(record) {
    try {
      if (record.writable) {
        await record.writable.close();
        record.writable = null;
        app.toast(app.t('files.savedTo', { name: record.name }));
      } else {
        const blob = new Blob(record.parts, { type: record.mime });
        record.parts.length = 0; // release references immediately
        record.parts = null;
        triggerDownload(blob, record.name);
        app.toast(app.t('files.received', { name: record.name }));
      }
      record.status = 'done';
    } catch (err) {
      record.status = 'failed';
      record.error = err?.message || app.t('errors.generic');
    }
    currentReceive = null;
    uiDirty = true;
    render();
  }

  function handleControl(message) {
    if (message?.t === 'file:cancel') {
      const record = currentReceive;
      if (record && record.id === message.id) {
        // Peer cancelled mid-transfer.
        if (record.writable) {
          try {
            record.writable.abort?.();
          } catch {
            /* ignore */
          }
        }
        record.status = 'cancelled';
        currentReceive = null;
        uiDirty = true;
        render();
      }
    }
  }

  /* ---- rendering ---------------------------------------------------- */

  function statusLabel(record) {
    if (record.status === 'receiving') return t('files.status.receiving');
    return t('files.status.' + record.status);
  }

  function render() {
    uiDirty = false;
    const list = $('[data-transfer-list]');
    const empty = $('[data-files-empty]');
    if (!list) return;
    if (empty) empty.hidden = transfers.length > 0;

    list.textContent = '';
    for (const record of transfers) {
      list.appendChild(renderRow(record));
    }
  }

  const ROWS = new Map(); // id -> { node, bar, percent, meta, actions }

  function renderRow(record) {
    let cached = ROWS.get(record.id);
    if (!cached) {
      const node = document.createElement('li');
      node.className = 'transfer';
      node.dataset.id = record.id;

      const icon = document.createElement('span');
      icon.className = 'transfer-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = arrowIcon(record.direction);

      const main = document.createElement('div');
      main.className = 'transfer-main';
      const name = document.createElement('span');
      name.className = 'transfer-name';
      const meta = document.createElement('span');
      meta.className = 'transfer-meta';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      bar.appendChild(fill);
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      main.append(name, meta, bar);

      const actions = document.createElement('div');
      actions.className = 'transfer-actions';

      node.append(icon, main, actions);
      cached = { node, name, meta, bar, fill, actions, signature: '' };
      ROWS.set(record.id, cached);
    }

    // Only touch the DOM when something actually changed.
    const percent = record.size ? Math.min(100, (record.transferred / record.size) * 100) : 0;
    const signature = [
      record.status,
      record.name,
      record.size,
      Math.round(percent),
      record.error,
      record.direction,
    ].join('|');
    if (cached.signature === signature) return cached.node;
    cached.signature = signature;

    cached.name.textContent = record.name;
    cached.fill.style.width = percent.toFixed(1) + '%';
    cached.bar.setAttribute('aria-valuenow', String(Math.round(percent)));

    const dirLabel = record.direction === 'to-phone' ? t('files.dir.toPhone') : t('files.dir.toLaptop');
    const metaBits = [dirLabel, formatBytes(record.size)];
    if (record.status === 'sending' || record.status === 'receiving') {
      metaBits.push(`${Math.round(percent)}%`);
      metaBits.push(`${formatBytes(record.speed)}/s`);
      metaBits.push(`${t('files.eta')}: ${formatEta(record.eta)}`);
    } else {
      metaBits.push(statusLabel(record));
    }
    if (record.error) metaBits.push(record.error);
    cached.meta.textContent = metaBits.join(' · ');

    cached.actions.textContent = '';
    const active = record.status === 'sending' || record.status === 'receiving' || record.status === 'queued';
    if (active) {
      cached.actions.appendChild(
        actionButton(t('files.cancel'), 'files.cancel', () => cancel(record)),
      );
    } else if (record.status === 'failed') {
      cached.actions.appendChild(
        actionButton(t('files.retry'), 'files.retry', () => retry(record)),
      );
    }
    return cached.node;
  }

  function actionButton(label, i18nKey, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost btn-small';
    button.textContent = label;
    button.dataset.i18n = i18nKey;
    button.addEventListener('click', onClick);
    return button;
  }

  function arrowIcon(direction) {
    const up = direction === 'to-laptop';
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="${up ? 'M6 11l6-6 6 6' : 'M6 13l6 6 6-6'}"/></svg>`;
  }

  /**
   * Speed/ETA are recomputed on a timer rather than inside the chunk loop, so
   * the hot path stays free of allocations.
   */
  function tick() {
    let changed = false;
    for (const record of transfers) {
      if (record.status !== 'sending' && record.status !== 'receiving') continue;
      const now = performance.now();
      const dt = (now - record._lastTs) / 1000;
      if (dt > 0.4) {
        record.speed = (record.transferred - record._lastBytes) / dt;
        record._lastBytes = record.transferred;
        record._lastTs = now;
        record.eta = record.speed > 0 ? (record.size - record.transferred) / record.speed * 1000 : Infinity;
        changed = true;
      }
    }
    if (changed || uiDirty) render();
    // Prune cached DOM entries for records that no longer exist.
    if (ROWS.size > transfers.length + 8) {
      for (const id of [...ROWS.keys()]) {
        if (!findById(id)) ROWS.delete(id);
      }
    }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ---- wiring ------------------------------------------------------- */

  function bind() {
    const input = $('[data-files-input]');
    $('[data-files-send]')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      enqueue([...input.files]);
      input.value = ''; // allow sending the same file twice
    });
    $('[data-files-clear]')?.addEventListener('click', () => {
      transfers.length = 0;
      ROWS.clear();
      uiDirty = true;
      render();
    });

    const dropzone = $('[data-dropzone]');
    if (dropzone && app.role === 'laptop') {
      const highlight = (on) => dropzone.classList.toggle('is-dragover', on);
      dropzone.addEventListener('dragover', (event) => {
        event.preventDefault();
        highlight(true);
      });
      dropzone.addEventListener('dragleave', () => highlight(false));
      dropzone.addEventListener('drop', (event) => {
        event.preventDefault();
        highlight(false);
        enqueue([...event.dataTransfer.files]);
      });
    }

    tickTimer = setInterval(tick, 400);
  }

  bind();
  void restoreSaveFolder();
  render();

  app.on('session', (session) => {
    if (!session) return;
    session.on('file-chunk', (data) => {
      if (typeof data === 'string') {
        try {
          const meta = JSON.parse(data);
          if (meta.k === META_KIND) void beginReceive(meta);
        } catch {
          /* ignore malformed header */
        }
      } else {
        void onChunk(data);
      }
    });
  });

  app.on('control', handleControl);

  app.on('disconnected', () => {
    for (const record of transfers) {
      if (record.status === 'sending' || record.status === 'receiving' || record.status === 'queued') {
        if (record.writable) {
          try {
            record.writable.abort?.();
          } catch {
            /* ignore */
          }
        }
        record.status = 'failed';
        record.error = t('errors.channelClosed');
      }
    }
    currentSend = null;
    currentReceive = null;
    queue.length = 0;
    uiDirty = true;
    render();
  });

  // Expose the folder picker to the settings screen.
  app.canPickFolder = canPickFolder;
  app.chooseSaveFolder = chooseSaveFolder;

  return { chooseSaveFolder, formatBytes };
}
