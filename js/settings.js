// Settings and small pieces of persistent state.
//
// Everything is stored in localStorage and every access is wrapped in
// try/catch: private browsing modes and strict cookie settings can make
// localStorage throw, and an app that refuses to start because it cannot save
// a theme preference would be silly.

import { Emitter } from './rtc.js';

const SETTINGS_KEY = 'linkdrop.settings.v1';
const TRUSTED_KEY = 'linkdrop.trusted.v1';
const IDENTITY_KEY = 'linkdrop.identity.v1';

/** Factory defaults. `null` means "decide at runtime". */
export const DEFAULT_SETTINGS = Object.freeze({
  deviceName: '',
  theme: 'system', // system | light | dark
  defaultCamera: 'back', // front | back
  resolution: '720p', // 360p | 720p | 1080p
  frameRate: 30, // 15 | 30 | 60
  audio: false,
  keepAwake: true,
  rememberDevice: false,
  saveToDisk: true, // use the File System Access API when available
  language: null, // null -> follow the browser
});

/** Resolution presets used by the camera code and the settings UI. */
export const RESOLUTIONS = {
  '360p': { width: 640, height: 360 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export const FRAME_RATES = [15, 30, 60];

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export class Settings extends Emitter {
  constructor() {
    super();
    this.values = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_KEY, {}) };
  }

  get(key) {
    return this.values[key];
  }

  /** Return the effective language, falling back to the browser's. */
  get language() {
    if (this.values.language) return this.values.language;
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('id') ? 'id' : 'en';
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    writeJson(SETTINGS_KEY, this.values);
    this.emit('change', { key, value, values: this.values });
    this.emit('change:' + key, value);
  }

  patch(partial) {
    for (const [key, value] of Object.entries(partial)) this.set(key, value);
  }

  /** Wipe settings and remembered devices. */
  reset() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(TRUSTED_KEY);
      localStorage.removeItem(IDENTITY_KEY);
    } catch {
      /* ignore */
    }
    this.values = { ...DEFAULT_SETTINGS };
    this.emit('change', { key: null, value: null, values: this.values });
  }

  /* ---- device identity ------------------------------------------------ */

  /**
   * A stable, friendly default device name so users do not have to type one.
   * Stored separately from settings so "reset pairing" can keep it.
   */
  get identity() {
    let identity = readJson(IDENTITY_KEY, null);
    if (!identity) {
      identity = { name: defaultDeviceName(), id: randomId() };
      writeJson(IDENTITY_KEY, identity);
    }
    return identity;
  }

  get deviceName() {
    return this.values.deviceName || this.identity.name;
  }

  /* ---- remembered ("trusted") devices --------------------------------- */

  /**
   * Remembered devices are keyed by the 4-digit verification number, which is
   * derived from the actual DTLS certificates. Remembering it means "the same
   * two browsers paired successfully before", nothing more.
   */
  isTrusted(verificationNumber, deviceName) {
    if (!this.values.rememberDevice) return false;
    const list = readJson(TRUSTED_KEY, []);
    return list.some(
      (entry) =>
        entry.code === verificationNumber &&
        (!deviceName || !entry.name || entry.name === deviceName),
    );
  }

  trust(verificationNumber, deviceName) {
    const list = readJson(TRUSTED_KEY, []);
    if (!list.some((e) => e.code === verificationNumber && e.name === deviceName)) {
      list.push({ code: verificationNumber, name: deviceName, at: Date.now() });
      // Keep the list small; these are personal devices, not a database.
      while (list.length > 20) list.shift();
      writeJson(TRUSTED_KEY, list);
    }
  }

  forgetAll() {
    try {
      localStorage.removeItem(TRUSTED_KEY);
    } catch {
      /* ignore */
    }
  }
}

function randomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultDeviceName() {
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return mobile ? 'Phone' : 'Computer';
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

/** Apply the theme preference to the document. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme; // fall back to prefers-color-scheme
  }
}

/* ------------------------------------------------------------------ *
 * Settings screen
 * ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A group of pill buttons; only one option is active at a time. */
function segmented(options, value, onPick) {
  const wrap = el('div', 'segmented');
  wrap.setAttribute('role', 'group');
  for (const option of options) {
    const button = el('button', 'seg' + (option.value === value ? ' is-active' : ''), option.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(option.value === value));
    button.addEventListener('click', () => onPick(option.value));
    wrap.appendChild(button);
  }
  return wrap;
}

/** An accessible on/off switch. */
function toggle(checked, onPick, label) {
  const button = el('button', 'switch' + (checked ? ' is-on' : ''));
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(checked));
  if (label) button.setAttribute('aria-label', label);
  button.appendChild(el('span', 'switch-knob'));
  button.addEventListener('click', () => onPick(!checked));
  return button;
}

function row(t, titleKey, helpKey, control) {
  const wrap = el('div', 'setting');
  const text = el('div', 'setting-text');
  text.appendChild(el('span', 'setting-title', t(titleKey)));
  if (helpKey) text.appendChild(el('small', 'setting-help', t(helpKey)));
  const ctrl = el('div', 'setting-control');
  ctrl.appendChild(control);
  wrap.append(text, ctrl);
  return wrap;
}

function group(t, titleKey, children) {
  const section = el('section', 'card settings-group');
  section.appendChild(el('h2', 'card-title', t(titleKey)));
  const body = el('div', 'card-body');
  for (const child of children) body.appendChild(child);
  section.appendChild(body);
  return section;
}

/**
 * Build the settings screen. Re-renders itself after every change so the
 * active states always match the stored values.
 *
 * @param {object} app the shared app object (needs settings, t, toast)
 * @returns {HTMLElement}
 */
export function mountSettings(app) {
  const { settings, t } = app;
  const root = el('div', 'settings-form');

  const render = () => {
    root.textContent = '';

    root.appendChild(
      group(t, 'settings.group.device', [
        (() => {
          const input = el('input', 'text-input');
          input.type = 'text';
          input.value = settings.deviceName;
          input.maxLength = 40;
          input.setAttribute('aria-label', t('settings.deviceName'));
          // Save on blur/change rather than every keystroke.
          input.addEventListener('change', () => {
            settings.set('deviceName', input.value.trim());
            app.toast(t('settings.saved'));
          });
          return row(t, 'settings.deviceName', 'settings.deviceName.help', input);
        })(),
        row(
          t,
          'settings.theme',
          'settings.theme.help',
          segmented(
            [
              { value: 'system', label: t('settings.theme.system') },
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
            ],
            settings.get('theme'),
            (value) => {
              settings.set('theme', value);
              applyTheme(value);
              render();
            },
          ),
        ),
      ]),
    );

    root.appendChild(
      group(t, 'settings.group.camera', [
        row(
          t,
          'settings.defaultCamera',
          'settings.defaultCamera.help',
          segmented(
            [
              { value: 'front', label: t('camera.controls.front') },
              { value: 'back', label: t('camera.controls.back') },
            ],
            settings.get('defaultCamera'),
            (value) => {
              settings.set('defaultCamera', value);
              render();
            },
          ),
        ),
        row(
          t,
          'settings.resolution',
          'settings.resolution.help',
          segmented(
            Object.keys(RESOLUTIONS).map((key) => ({ value: key, label: key })),
            settings.get('resolution'),
            (value) => {
              settings.set('resolution', value);
              render();
            },
          ),
        ),
        row(
          t,
          'settings.frameRate',
          'settings.frameRate.help',
          segmented(
            FRAME_RATES.map((fps) => ({ value: fps, label: fps + ' fps' })),
            settings.get('frameRate'),
            (value) => {
              settings.set('frameRate', Number(value));
              render();
            },
          ),
        ),
        row(
          t,
          'settings.audio',
          'settings.audio.help',
          toggle(settings.get('audio'), (value) => {
            settings.set('audio', value);
            render();
          }, t('settings.audio')),
        ),
      ]),
    );

    root.appendChild(
      group(t, 'settings.group.connection', [
        row(
          t,
          'settings.keepAwake',
          'settings.keepAwake.help',
          toggle(settings.get('keepAwake'), (value) => {
            settings.set('keepAwake', value);
            render();
          }, t('settings.keepAwake')),
        ),
        row(
          t,
          'settings.rememberDevice',
          'settings.rememberDevice.help',
          toggle(settings.get('rememberDevice'), (value) => {
            settings.set('rememberDevice', value);
            render();
          }, t('settings.rememberDevice')),
        ),
      ]),
    );

    root.appendChild(
      group(t, 'settings.group.storage', [
        row(
          t,
          'settings.saveToDisk',
          'settings.saveToDisk.help',
          (() => {
            const wrap = el('div', 'setting-inline');
            wrap.appendChild(
              toggle(settings.get('saveToDisk'), (value) => {
                settings.set('saveToDisk', value);
                render();
              }, t('settings.saveToDisk')),
            );
            if (app.canPickFolder()) {
              const button = el('button', 'btn btn-ghost', t('files.chooseFolder'));
              button.type = 'button';
              button.addEventListener('click', () => app.chooseSaveFolder());
              wrap.appendChild(button);
            }
            return wrap;
          })(),
        ),
      ]),
    );

    root.appendChild(
      group(t, 'settings.group.preferences', [
        row(
          t,
          'settings.language',
          'settings.language.help',
          segmented(
            [
              { value: 'en', label: 'English' },
              { value: 'id', label: 'Bahasa Indonesia' },
            ],
            app.language(),
            (value) => {
              settings.set('language', value);
              app.applyLanguage(value);
              render();
            },
          ),
        ),
        row(
          t,
          'settings.reset',
          'settings.reset.help',
          (() => {
            const button = el('button', 'btn btn-danger', t('settings.resetButton'));
            button.type = 'button';
            button.addEventListener('click', () => {
              settings.reset();
              app.applyLanguage(settings.language);
              applyTheme(settings.get('theme'));
              app.onReset();
              render();
              app.toast(t('settings.resetDone'));
            });
            return button;
          })(),
        ),
      ]),
    );

    root.appendChild(
      (() => {
        const about = el('section', 'card settings-group');
        about.appendChild(el('h2', 'card-title', t('settings.group.about')));
        const body = el('div', 'card-body');
        const line = el('p', 'muted small');
        line.textContent = 'LinkDrop — MIT licensed. Video and files never leave your two devices.';
        body.appendChild(line);
        about.appendChild(body);
        return about;
      })(),
    );
  };

  render();
  return root;
}
