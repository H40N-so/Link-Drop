// Live "Connection details" log.
//
// Every stage of pairing writes a timestamped line here: signaling, the offer
// and answer, ICE gathering and candidate types, DTLS, the data channels and
// the verification step. The signaling adapters and the RTC session push into
// the shared `connLog` singleton directly, so the panel is the same on the
// laptop and on the phone and nothing has to be threaded through the UI.
//
// The panel is collapsed by default and expands itself the moment something
// fails, which is exactly when a user wants to see it.

import { t } from './i18n.js';
import { icon } from './icons.js';

const MAX_ENTRIES = 400;

const STATUS_ICON = {
  info: 'circle',
  ok: 'check-circle',
  warn: 'alert',
  fail: 'x-circle',
  debug: 'info',
};

/** Seconds with millisecond precision, measured from the start of the run. */
function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const ms = Math.round((safe - whole) * 1000);
  return `${whole}.${String(ms).padStart(3, '0')}s`;
}

class ConnectionLog {
  constructor() {
    this.entries = [];
    this.startedAt = performance.now();
    this.hasFailure = false;
    this._listeners = new Set();
  }

  _push(status, text) {
    if (!text) return;
    const entry = { at: (performance.now() - this.startedAt) / 1000, status, text };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    if (status === 'fail') this.hasFailure = true;
    this._emit();
  }

  info(text) {
    this._push('info', text);
  }

  ok(text) {
    this._push('ok', text);
  }

  warn(text) {
    this._push('warn', text);
  }

  fail(text) {
    this._push('fail', text);
  }

  debug(text) {
    this._push('debug', text);
  }

  /** Start a fresh run for a new connection attempt. */
  begin(label) {
    this.entries = [];
    this.startedAt = performance.now();
    this.hasFailure = false;
    if (label) this.info(label);
    this._emit();
  }

  get text() {
    return this.entries
      .map((e) => `[${formatTime(e.at)}] ${e.status.toUpperCase()} ${e.text}`)
      .join('\n');
  }

  onChange(handler) {
    this._listeners.add(handler);
    return () => this._listeners.delete(handler);
  }

  _emit() {
    for (const handler of [...this._listeners]) {
      try {
        handler(this);
      } catch {
        /* a broken panel must never break pairing */
      }
    }
  }
}

export const connLog = new ConnectionLog();

/**
 * Build a collapsible Connection-details panel inside `container`.
 *
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {boolean} [options.autoExpand=true] expand automatically on failure
 * @returns {{ setOpen: (value: boolean) => void, dispose: () => void } | null}
 */
export function mountConnectionLog(container, { autoExpand = true } = {}) {
  if (!container) return null;
  container.classList.add('conn-log');
  container.textContent = '';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'conn-log__toggle';
  toggle.setAttribute('aria-expanded', 'false');

  const title = document.createElement('span');
  title.className = 'conn-log__title';
  title.textContent = t('log.title');

  const chevron = document.createElement('span');
  chevron.className = 'conn-log__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = icon('chevron-down', 'icon--sm');
  toggle.append(title, chevron);

  const body = document.createElement('div');
  body.className = 'conn-log__body';
  body.hidden = true;

  const list = document.createElement('ol');
  list.className = 'conn-log__list';

  const footer = document.createElement('div');
  footer.className = 'conn-log__footer';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn--small';
  copyBtn.textContent = t('log.copy');
  footer.appendChild(copyBtn);

  body.append(list, footer);
  container.append(toggle, body);

  let open = false;
  const setOpen = (value) => {
    open = value;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    container.classList.toggle('is-open', open);
    if (open) list.scrollTop = list.scrollHeight;
  };
  toggle.addEventListener('click', () => setOpen(!open));

  copyBtn.addEventListener('click', async () => {
    const text = connLog.text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard needs a secure context and permission; select instead.
      const range = document.createRange();
      range.selectNodeContents(list);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    copyBtn.textContent = t('log.copied');
    setTimeout(() => {
      copyBtn.textContent = t('log.copy');
    }, 1500);
  });

  const render = () => {
    list.textContent = '';
    for (const entry of connLog.entries) {
      const row = document.createElement('li');
      row.className = 'conn-log__row';
      row.dataset.state = entry.status;

      const mark = document.createElement('span');
      mark.className = 'conn-log__icon';
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = icon(STATUS_ICON[entry.status] || 'circle', 'icon--sm');

      const time = document.createElement('span');
      time.className = 'conn-log__time';
      time.textContent = formatTime(entry.at);

      const text = document.createElement('span');
      text.className = 'conn-log__text';
      text.textContent = entry.text;

      row.append(mark, time, text);
      list.appendChild(row);
    }
    if (autoExpand && connLog.hasFailure && !open) setOpen(true);
  };

  render();
  const off = connLog.onChange(render);

  return { setOpen, dispose: off };
}
