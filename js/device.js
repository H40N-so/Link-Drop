// Device-class detection.
//
// LinkDrop has two pages with different jobs: the laptop page (index.html)
// shows the QR code and the numeric code, and the phone page (phone.html) is
// where the camera lives. Showing the wrong one is confusing, so each page
// checks whether the current device matches.
//
// The heuristics below are deliberately forgiving and can be bypassed with the
// documented developer flag `?dev=1` (see CONTRIBUTING.md) when testing two
// roles on a single machine.

const MOBILE_UA_RE =
  /Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|Mobile|Silk|Kindle|BlackBerry/i;
const DESKTOP_UA_RE = /Windows NT|Macintosh|X11|CrOS|Linux x86_64|Linux i686|Linux aarch64/i;

/** True when the device reports any touch input. */
export function hasTouch() {
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

/** True when the primary pointer is coarse (a finger). */
export function coarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/** True when the primary pointer is fine (a mouse or trackpad). */
export function finePointer() {
  return window.matchMedia?.('(pointer: fine)').matches ?? false;
}

/** True for a mobile user agent. */
export function isMobileUA() {
  return MOBILE_UA_RE.test(navigator.userAgent || '');
}

/** Rough viewport class from the largest dimension we know about. */
export function viewportClass() {
  const width = Math.max(window.innerWidth || 0, window.screen?.width || 0);
  if (width >= 1024) return 'wide';
  if (width <= 520) return 'narrow';
  return 'medium';
}

/**
 * A desktop-class device: a fine pointer, no coarse pointer and either a wide
 * viewport or a desktop user agent.
 */
export function isDesktopClass() {
  if (isDeviceOverride()) return false;
  if (coarsePointer()) return false;
  if (!finePointer()) return false;
  if (hasTouch()) return false;
  return viewportClass() === 'wide' || DESKTOP_UA_RE.test(navigator.userAgent || '');
}

/**
 * A phone-class device: a coarse pointer, a mobile user agent or a narrow
 * viewport.
 *
 * Touch input alone is deliberately NOT enough: touchscreen laptops still use
 * a fine pointer and a wide viewport, and must not be treated as phones.
 */
export function isPhoneClass() {
  if (isDeviceOverride()) return false;
  if (coarsePointer()) return true;
  if (isMobileUA()) return true;
  return viewportClass() === 'narrow';
}

/**
 * Documented developer override (`?dev=1`). It only relaxes the page/device
 * guards for local testing; it never changes the pairing flow itself.
 */
export function isDeviceOverride() {
  try {
    const value = new URLSearchParams(window.location.search).get('dev');
    return value === '1' || value === 'true';
  } catch {
    return false;
  }
}
