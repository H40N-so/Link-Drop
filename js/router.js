// Screen router for both the laptop shell and the phone shell.
//
// Handles which screen is visible, the direction-aware transition (the View
// Transitions API when available, a CSS animation otherwise), per-screen scroll
// memory and the staggered reveal of lists and cards.

const REDUCED_MOTION = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export class ScreenRouter {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root element that contains every screen
   * @param {string[]} options.ids screen ids in visual order (for direction)
   * @param {string} options.initial initially visible screen id
   * @param {HTMLElement} [options.scroller] the scroll container, for scroll memory
   * @param {(id: string, previous: string|null, direction: string) => void} [options.onChange]
   */
  constructor({ root, ids, initial, onChange, scroller }) {
    this.root = root;
    this.ids = ids.slice();
    this.current = initial || ids[0];
    this.onChange = onChange;
    this.scroller = scroller || null;
    this._scroll = new Map();

    for (const id of ids) {
      const el = this._element(id);
      if (el) el.classList.toggle('is-active', id === this.current);
    }
  }

  _element(id) {
    return this.root.querySelector(`[data-screen="${id}"]`);
  }

  _scroller() {
    return this.scroller || this.root;
  }

  _direction(fromId, toId) {
    const a = this.ids.indexOf(fromId);
    const b = this.ids.indexOf(toId);
    if (a === -1 || b === -1 || a === b) return 'none';
    return b > a ? 'forward' : 'backward';
  }

  get currentId() {
    return this.current;
  }

  show(id, { direction } = {}) {
    if (!this.ids.includes(id) || id === this.current) return;
    const previous = this.current;
    const dir = direction || this._direction(previous, id);
    const fromEl = this._element(previous);
    const toEl = this._element(id);

    // Remember where the user was in the screen we are leaving.
    if (fromEl) this._scroll.set(previous, this._scroller(fromEl).scrollTop || 0);

    const swap = () => {
      fromEl?.classList.remove('is-active');
      toEl?.classList.add('is-active');
      this.current = id;
      // Restore the remembered scroll position for the target screen.
      const scroller = this._scroller(toEl);
      if (scroller) scroller.scrollTop = this._scroll.get(id) || 0;
      this.stagger(toEl);
    };

    const root = document.documentElement;
    root.dataset.navDir = dir;

    if (typeof document.startViewTransition === 'function' && !REDUCED_MOTION()) {
      root.dataset.vtDir = dir;
      const transition = document.startViewTransition(swap);
      const clearDir = () => {
        delete root.dataset.vtDir;
      };
      // `ready` and `finished` both reject with AbortError when a newer
      // transition skips this one; that is expected, so handle both outcomes.
      transition.ready.catch(() => {});
      transition.finished.then(clearDir, clearDir);
    } else {
      // CSS fallback: replay a directional slide on the entering screen.
      swap();
      if (toEl && !REDUCED_MOTION()) {
        toEl.classList.remove('enter-forward', 'enter-backward');
        // Force a reflow so the animation restarts on every navigation.
        void toEl.offsetWidth;
        toEl.classList.add(dir === 'backward' ? 'enter-backward' : 'enter-forward');
      }
    }

    this.onChange?.(id, previous, dir);
  }

  /** Add a small staggered fade-in to direct children of every [data-stagger]. */
  stagger(scope = this.root) {
    if (!scope) return;
    const groups = scope.querySelectorAll('[data-stagger]');
    for (const group of groups) {
      const children = [...group.children];
      children.forEach((child, index) => {
        child.style.setProperty('--i', String(Math.min(index, 12)));
        child.classList.remove('reveal');
      });
      if (REDUCED_MOTION()) {
        children.forEach((child) => child.classList.add('reveal'));
        continue;
      }
      void group.offsetWidth;
      children.forEach((child) => child.classList.add('reveal'));
    }
  }
}
