// One-click "Connection check" (Help page, laptop and phone).
//
// It probes, from this device, everything a pairing needs and explains the
// result in plain language:
//   - the PeerJS server (the pairing service)
//   - every configured MQTT broker (only when the backup is enabled)
//   - STUN reachability, by gathering real ICE candidates
//   - which candidate types this device can gather (host / srflx / relay)
//
// Nothing here touches an existing session; every probe uses its own very
// short-lived connection and tears it down immediately.

import { ICE_SERVERS, MQTT_BROKERS, CHECK_CONFIG, ENABLE_BACKUP_SIGNALING } from '../config.js';
import { peerJsOptions, peerJsHostLabel } from './signaling-peerjs.js';
import { t } from './i18n.js';
import { icon } from './icons.js';

const STATUS = { pending: 'pending', running: 'running', pass: 'pass', warn: 'warn', fail: 'fail' };

/** The brokers to probe: none while the backup signaling is disabled. */
function activeBrokers() {
  return ENABLE_BACKUP_SIGNALING ? MQTT_BROKERS : [];
}

function brokerLabel(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Probe the PeerJS server by opening (then closing) a random peer. */
function checkPeerJs() {
  return new Promise((resolve) => {
    if (typeof window.Peer !== 'function') {
      resolve({ status: STATUS.fail, detail: t('checks.detail.bundleMissing') });
      return;
    }
    let settled = false;
    let peer = null;
    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      try {
        peer?.destroy();
      } catch {
        /* ignore */
      }
      resolve({ status, detail });
    };
    const timer = setTimeout(() => finish(STATUS.fail, t('checks.detail.timeout')), CHECK_CONFIG.serviceTimeoutMs);
    try {
      peer = new window.Peer(undefined, { ...peerJsOptions(), debug: 0 });
    } catch {
      clearTimeout(timer);
      finish(STATUS.fail, t('checks.detail.error'));
      return;
    }
    peer.on('open', () => {
      clearTimeout(timer);
      finish(STATUS.pass, t('checks.detail.reachable'));
    });
    peer.on('error', (err) => {
      clearTimeout(timer);
      const type = err?.type || '';
      finish(
        STATUS.fail,
        type === 'network' || type === 'server-error' || type === 'socket-error'
          ? t('checks.detail.blocked')
          : t('checks.detail.error')
      );
    });
  });
}

/** Probe a single MQTT broker. */
function checkBroker(url) {
  return new Promise((resolve) => {
    if (!window.mqtt) {
      resolve({ status: STATUS.fail, detail: t('checks.detail.bundleMissing') });
      return;
    }
    let settled = false;
    let client = null;
    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      try {
        client?.end(true);
      } catch {
        /* ignore */
      }
      resolve({ status, detail });
    };
    const timer = setTimeout(() => finish(STATUS.fail, t('checks.detail.timeout')), CHECK_CONFIG.serviceTimeoutMs + 1000);
    try {
      client = window.mqtt.connect(url, {
        connectTimeout: CHECK_CONFIG.serviceTimeoutMs,
        reconnectPeriod: 0,
        clean: true,
        clientId: `linkdrop-check-${Math.random().toString(16).slice(2, 10)}`,
      });
    } catch {
      clearTimeout(timer);
      finish(STATUS.fail, t('checks.detail.error'));
      return;
    }
    client.on('connect', () => {
      clearTimeout(timer);
      finish(STATUS.pass, t('checks.detail.reachable'));
    });
    client.on('error', () => {
      clearTimeout(timer);
      finish(STATUS.fail, t('checks.detail.unreachable'));
    });
  });
}

/** Gather real ICE candidates and report which types this device produced. */
function gatherCandidates() {
  return new Promise((resolve) => {
    const types = { host: false, srflx: false, prflx: false, relay: false };
    let pc = null;
    try {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    } catch {
      resolve({ ok: false, types });
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: true, types });
    };
    const timer = setTimeout(done, CHECK_CONFIG.stunTimeoutMs);
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        done();
        return;
      }
      const type = event.candidate.type || /(?:typ\s+)(\w+)/.exec(event.candidate.candidate || '')?.[1];
      if (type && type in types) types[type] = true;
    };
    try {
      pc.createDataChannel('probe');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(done);
    } catch {
      done();
    }
  });
}

/** Plain-language verdict from the gathered facts. */
function buildConclusion({ peerjs, brokers, ice }) {
  const anySignaling = peerjs.status === STATUS.pass || brokers.some((b) => b.status === STATUS.pass);
  if (!anySignaling) return t('checks.conclNoSignaling');
  if (ice.types.relay) return t('checks.conclTurn');
  if (ice.types.srflx) return t('checks.conclStun');
  if (ice.types.host) return t('checks.conclLocalOnly');
  return t('checks.conclUnknown');
}

/**
 * Run every probe, calling `onProgress` as each result arrives.
 * @param {(id: string, result: object) => void} [onProgress]
 */
export async function runConnectionCheck(onProgress) {
  const emit = (id, result) => onProgress?.(id, result);

  const brokerUrls = activeBrokers();
  const results = {
    peerjs: { status: STATUS.pending },
    brokers: brokerUrls.map((url) => ({ url, label: brokerLabel(url), status: STATUS.pending })),
    ice: { ok: false, types: { host: false, srflx: false, prflx: false, relay: false } },
    conclusion: '',
  };

  const peerjsPromise = checkPeerJs().then((r) => {
    results.peerjs = r;
    emit('peerjs', r);
    return r;
  });

  const brokerPromises = results.brokers.map((broker, index) =>
    checkBroker(broker.url).then((r) => {
      Object.assign(broker, r);
      emit(`broker:${index}`, { ...broker, ...r });
      return r;
    })
  );

  const icePromise = gatherCandidates().then((r) => {
    results.ice = r;
    emit('ice', r);
    return r;
  });

  await Promise.all([peerjsPromise, icePromise, ...brokerPromises]);

  results.conclusion = buildConclusion(results);
  emit('conclusion', { status: STATUS.pass, detail: results.conclusion });
  return results;
}

/* ------------------------------------------------------------------ *
 * Help-page UI
 * ------------------------------------------------------------------ */

const ICON = {
  pending: icon('circle'),
  running: icon('loader'),
  pass: icon('check-circle'),
  warn: icon('alert'),
  fail: icon('x-circle'),
};

function makeRow(id, label) {
  const row = document.createElement('div');
  row.className = 'check-row';
  row.dataset.state = STATUS.pending;
  row.dataset.check = id;

  const icon = document.createElement('span');
  icon.className = 'check-row__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICON.pending;

  const text = document.createElement('div');
  text.className = 'check-row__text';
  const labelEl = document.createElement('span');
  labelEl.className = 'check-row__label';
  labelEl.textContent = label;
  const detail = document.createElement('span');
  detail.className = 'check-row__detail';
  detail.textContent = t('checks.notTested');
  text.append(labelEl, detail);

  row.append(icon, text);
  return { row, detail, icon, labelEl };
}

function setRow(rowParts, status, detail) {
  rowParts.row.dataset.state = status;
  rowParts.icon.innerHTML = ICON[status] || ICON.pending;
  if (detail) rowParts.detail.textContent = detail;
}

/**
 * Build the Connection check panel inside `container` and wire the button.
 * @param {HTMLElement} container
 * @returns {{ run: () => Promise<void> }}
 */
export function mountConnectionCheck(container) {
  container.innerHTML = '';
  container.classList.add('check-panel');

  const intro = document.createElement('p');
  intro.className = 'check-panel__intro';
  intro.textContent = t('checks.intro');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary';
  button.textContent = t('checks.run');

  const rowsHost = document.createElement('div');
  rowsHost.className = 'check-list';
  rowsHost.dataset.stagger = '';

  const rowMap = new Map();
  const addRow = (id, label) => {
    const parts = makeRow(id, label);
    rowsHost.appendChild(parts.row);
    rowMap.set(id, parts);
    return parts;
  };

  addRow('peerjs', t('checks.peerjs', { host: peerJsHostLabel() }));
  activeBrokers().forEach((url, index) => addRow(`broker:${index}`, t('checks.broker', { host: brokerLabel(url) })));
  const iceRow = addRow('ice', t('checks.ice'));

  // Candidate-type chips live under the ICE row.
  const chips = document.createElement('div');
  chips.className = 'check-chips';
  const chipEls = {};
  for (const [key, labelKey] of [
    ['host', 'checks.candidate.host'],
    ['srflx', 'checks.candidate.srflx'],
    ['relay', 'checks.candidate.relay'],
  ]) {
    const chip = document.createElement('span');
    chip.className = 'check-chip';
    chip.dataset.type = key;
    chip.textContent = t(labelKey);
    chips.appendChild(chip);
    chipEls[key] = chip;
  }
  iceRow.row.querySelector('.check-row__text').appendChild(chips);

  const conclusion = document.createElement('div');
  conclusion.className = 'check-conclusion';
  conclusion.hidden = true;

  container.append(intro, button, rowsHost, conclusion);

  let running = false;

  const resetRows = () => {
    setRow(rowMap.get('peerjs'), STATUS.pending, t('checks.notTested'));
    rowMap.forEach((parts, id) => {
      if (id.startsWith('broker:')) setRow(parts, STATUS.pending, t('checks.notTested'));
    });
    setRow(iceRow, STATUS.pending, t('checks.notTested'));
    for (const chip of Object.values(chipEls)) chip.dataset.on = 'false';
    conclusion.hidden = true;
    rowsHost.querySelectorAll('.check-row').forEach((r) => {
      r.classList.remove('reveal');
    });
  };

  const run = async () => {
    if (running) return;
    running = true;
    button.disabled = true;
    button.textContent = t('checks.running');
    resetRows();
    setRow(rowMap.get('peerjs'), STATUS.running, t('checks.testing'));
    rowMap.forEach((parts, id) => {
      if (id.startsWith('broker:')) setRow(parts, STATUS.running, t('checks.testing'));
    });
    setRow(iceRow, STATUS.running, t('checks.testing'));

    await runConnectionCheck((id, result) => {
      if (id === 'peerjs') {
        setRow(rowMap.get('peerjs'), result.status, result.detail);
      } else if (id.startsWith('broker:')) {
        setRow(rowMap.get(id), result.status, result.detail);
      } else if (id === 'ice') {
        const types = result.types || {};
        for (const [key, chip] of Object.entries(chipEls)) chip.dataset.on = types[key] ? 'true' : 'false';
        const got = ['host', 'srflx', 'relay'].filter((k) => types[k]);
        setRow(
          iceRow,
          got.length ? STATUS.pass : STATUS.warn,
          got.length ? t('checks.iceGathered') : t('checks.detail.none')
        );
      } else if (id === 'conclusion') {
        conclusion.hidden = false;
        conclusion.textContent = result.detail;
      }
    });

    // A broker count of zero passes is a warning, not a hard failure.
    rowMap.forEach((parts, id) => {
      if (id.startsWith('broker:') && parts.row.dataset.state === STATUS.pass) return;
    });

    button.disabled = false;
    button.textContent = t('checks.runAgain');
    running = false;
  };

  button.addEventListener('click', run);
  return { run };
}
