// Custom feedback components: modal dialogs (which become bottom sheets on
// phones), confirm/alert helpers, and a stacked toast system.
//
// Nothing in the app calls window.alert / confirm / prompt any more: every
// prompt goes through here so it matches the design system and is accessible.

import { icon } from './icons.js';

let layer = null;
let toastHost = null;
let openModals = 0;

function ensureLayer() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'ld-layer';
    layer.setAttribute('aria-live', 'off');
    document.body.appendChild(layer);
  }
  return layer;
}

function ensureToastHost() {
  if (!toastHost) {
    toastHost = document.getElementById('toasts');
  }
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = 'toasts';
    toastHost.className = 'ld-toasts';
    document.body.appendChild(toastHost);
  }
  toastHost.classList.add('ld-toasts');
  if (!toastHost.getAttribute('role')) toastHost.setAttribute('role', 'region');
  if (!toastHost.getAttribute('aria-label')) toastHost.setAttribute('aria-label', 'Notifications');
  return toastHost;
}

/* ------------------------------------------------------------------ *
 * Icons (the shared Lucide sprite)
 * ------------------------------------------------------------------ */

const ICONS = {
  success: icon('check-circle'),
  info: icon('info'),
  warning: icon('alert'),
  error: icon('x-circle'),
  close: icon('x'),
};

/* ------------------------------------------------------------------ *
 * Modal / bottom sheet
 * ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Open a dialog. On phones the CSS turns the same markup into a bottom sheet.
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {string|HTMLElement} [options.body] rich content
 * @param {Array<{label:string,value?:any,variant?:string,onClick?:Function}>} [options.actions]
 * @param {boolean} [options.dismissible=true] backdrop click / Escape / close button
 * @param {string} [options.closeLabel='Close'] aria-label for the close button
 * @param {Function} [options.onClose]
 * @returns {{ close: (value?: any) => void, element: HTMLElement, result: Promise<any> }}
 */
export function openModal(options = {}) {
  const {
    title = '',
    description = '',
    body,
    actions = [],
    dismissible = true,
    closeLabel = 'Close',
    onClose,
  } = options;

  const host = ensureLayer();
  const previouslyFocused = document.activeElement;
  const root = document.createElement('div');
  root.className = 'ld-modal';

  const backdrop = document.createElement('div');
  backdrop.className = 'ld-modal__backdrop';

  const card = document.createElement('div');
  card.className = 'ld-modal__card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const titleId = `ld-modal-title-${Math.random().toString(36).slice(2, 8)}`;
  if (title) card.setAttribute('aria-labelledby', titleId);

  let resolveResult;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });

  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    openModals = Math.max(0, openModals - 1);
    if (openModals === 0) document.documentElement.classList.remove('ld-scroll-lock');
    card.classList.add('is-closing');
    root.classList.add('is-closing');
    const finish = () => {
      root.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
      onClose?.(value);
      resolveResult(value);
    };
    // Match the CSS exit duration, but never hang if the animation is disabled.
    const timer = setTimeout(finish, 220);
    card.addEventListener('animationend', () => {
      clearTimeout(timer);
      finish();
    }, { once: true });
  };

  // Header
  if (title || dismissible) {
    const header = document.createElement('div');
    header.className = 'ld-modal__header';
    const h = document.createElement('h2');
    h.className = 'ld-modal__title';
    if (title) h.id = titleId;
    h.textContent = title;
    header.appendChild(h);
    if (dismissible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ld-modal__close';
      btn.setAttribute('aria-label', closeLabel);
      btn.innerHTML = ICONS.close;
      btn.addEventListener('click', () => close(undefined));
      header.appendChild(btn);
    }
    card.appendChild(header);
  }

  if (description || body) {
    const content = document.createElement('div');
    content.className = 'ld-modal__content';
    if (description) {
      const p = document.createElement('p');
      p.className = 'ld-modal__description';
      p.textContent = description;
      content.appendChild(p);
    }
    if (body instanceof HTMLElement) content.appendChild(body);
    else if (typeof body === 'string' && body) {
      const holder = document.createElement('div');
      holder.className = 'ld-modal__body';
      holder.innerHTML = body;
      content.appendChild(holder);
    }
    card.appendChild(content);
  }

  if (actions.length) {
    const footer = document.createElement('div');
    footer.className = 'ld-modal__actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn--${action.variant || 'ghost'}`;
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        if (action.onClick) action.onClick({ close });
        else close(action.value);
      });
      footer.appendChild(btn);
    }
    card.appendChild(footer);
  }

  root.appendChild(backdrop);
  root.appendChild(card);
  host.appendChild(root);
  openModals += 1;
  document.documentElement.classList.add('ld-scroll-lock');

  if (dismissible) {
    backdrop.addEventListener('click', () => close(undefined));
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      close(undefined);
      return;
    }
    if (event.key === 'Tab') {
      const nodes = [...card.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  root.addEventListener('keydown', onKeyDown);

  // Move focus inside the dialog.
  requestAnimationFrame(() => {
    const target =
      card.querySelector('[data-autofocus]') ||
      card.querySelector('.ld-modal__actions .btn') ||
      card.querySelector(FOCUSABLE) ||
      card;
    if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  return { close, element: card, result };
}

/** Promise-based confirm dialog. Resolves true when confirmed. */
export function confirmDialog({
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  body,
  closeLabel,
} = {}) {
  const modal = openModal({
    title,
    description,
    body,
    closeLabel,
    actions: [
      { label: cancelLabel, value: false, variant: 'ghost' },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return modal.result.then((value) => value === true);
}

/** Promise-based alert dialog. Resolves when dismissed. */
export function alertDialog({ title, description, body, closeLabel, okLabel = 'OK' } = {}) {
  return openModal({
    title,
    description,
    body,
    closeLabel,
    actions: [{ label: okLabel, value: true, variant: 'primary' }],
  }).result;
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

let toastSeq = 0;

/**
 * Show a toast.
 *
 * @param {string} message
 * @param {object} [options]
 * @param {'success'|'info'|'warning'|'error'} [options.type='info']
 * @param {number} [options.duration=4200] ms before auto-dismiss (0 = sticky)
 * @param {string} [options.closeLabel='Dismiss']
 * @returns {{ dismiss: () => void }}
 */
export function toast(message, options = {}) {
  const { type = 'info', duration = 4200, closeLabel = 'Dismiss' } = options;
  const host = ensureToastHost();

  const el = document.createElement('div');
  el.className = `ld-toast ld-toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.dataset.id = String(++toastSeq);

  const icon = document.createElement('span');
  icon.className = 'ld-toast__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICONS[type] || ICONS.info;

  const text = document.createElement('span');
  text.className = 'ld-toast__msg';
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ld-toast__close';
  closeBtn.setAttribute('aria-label', closeLabel);
  closeBtn.innerHTML = ICONS.close;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });

  const bar = document.createElement('span');
  bar.className = 'ld-toast__bar';
  bar.setAttribute('aria-hidden', 'true');

  el.append(icon, text, closeBtn, bar);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));

  let timer = null;
  let remaining = duration;
  let startedAt = performance.now();
  let gone = false;

  const schedule = (ms) => {
    startedAt = performance.now();
    timer = setTimeout(dismiss, ms);
  };

  const dismiss = () => {
    if (gone) return;
    gone = true;
    if (timer) clearTimeout(timer);
    el.classList.remove('is-in');
    el.classList.add('is-out');
    const remove = () => el.remove();
    el.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 320);
  };

  if (duration > 0) {
    bar.style.animationDuration = `${duration}ms`;
    schedule(duration);
    el.addEventListener('pointerenter', () => {
      if (gone) return;
      if (timer) clearTimeout(timer);
      timer = null;
      remaining -= performance.now() - startedAt;
      bar.style.animationPlayState = 'paused';
    });
    el.addEventListener('pointerleave', () => {
      if (gone || timer || remaining <= 0) return;
      bar.style.animationPlayState = 'running';
      schedule(Math.max(600, remaining));
    });
  } else {
    bar.style.display = 'none';
  }

  // Swipe to dismiss (horizontal drag) and click to dismiss.
  let startX = 0;
  let dragging = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.target === closeBtn) return;
    dragging = true;
    startX = e.clientX;
    el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) el.style.transform = `translateX(${dx}px)`;
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - startX;
    el.style.transform = '';
    if (Math.abs(dx) > 90) dismiss();
    else if (Math.abs(dx) < 4 && e.target !== closeBtn) dismiss();
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', () => {
    dragging = false;
    el.style.transform = '';
  });

  return { dismiss, element: el };
}

/* ------------------------------------------------------------------ *
 * Live reconnect / status banner
 * ------------------------------------------------------------------ */

/**
 * A small persistent banner used for "connection lost / reconnecting". Returns
 * a controller so the caller can update or remove it.
 */
export function banner(message, options = {}) {
  const { type = 'warning', actionLabel, onAction } = options;
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = `ld-toast ld-toast--${type} ld-toast--sticky is-in`;
  el.setAttribute('role', 'status');
  const icon = document.createElement('span');
  icon.className = 'ld-toast__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICONS[type] || ICONS.info;
  const text = document.createElement('span');
  text.className = 'ld-toast__msg';
  text.textContent = message;
  el.append(icon, text);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ld-toast__action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => onAction?.());
    el.appendChild(btn);
  }
  host.appendChild(el);
  return {
    element: el,
    update(next) {
      text.textContent = next;
    },
    dismiss() {
      el.remove();
    },
  };
}
