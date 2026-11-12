// Lucide-style icon sprite loader (see vendor/icons/icons.svg, ISC licence).
//
// The sprite is vendored locally and injected once into the document, so no
// icon ever comes from a CDN. After injection, any element can reference an
// icon by its symbol id:
//
//   <svg class="icon"><use href="#i-camera"></use></svg>
//
// `icon()` returns that markup as a string, for the few places that build DOM
// from JavaScript (toasts, connection check, file rows).

const SPRITE_URL = new URL('../vendor/icons/icons.svg', import.meta.url).href;

let spritePromise = null;

/** Inject the vendored sprite into the document (once). Safe to call often. */
export function mountIconSprite() {
  if (spritePromise) return spritePromise;
  spritePromise = fetch(SPRITE_URL)
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
    .then((markup) => {
      if (document.getElementById('ld-icon-sprite')) return;
      const holder = document.createElement('div');
      holder.id = 'ld-icon-sprite';
      holder.setAttribute('aria-hidden', 'true');
      // A hidden-but-present sprite keeps <use> working in every browser.
      holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      holder.innerHTML = markup;
      document.body.prepend(holder);
    })
    .catch(() => {
      // Without the sprite the icons are simply blank; the app keeps working.
    });
  return spritePromise;
}

/**
 * Markup for one icon, for code that builds DOM with innerHTML.
 * @param {string} name symbol id without the `i-` prefix
 * @param {string} [className] extra classes (e.g. 'icon--sm')
 */
export function icon(name, className = '') {
  return `<svg class="icon${className ? ` ${className}` : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}
