// In-page QR scanner for the phone.
//
// Uses the native BarcodeDetector when the browser has it, and falls back to
// the vendored jsQR (loaded as a global from vendor/jsQR.js) everywhere else.
// The camera is always the rear one, and the loop runs on requestAnimationFrame
// so it stays cheap while the dialog is open.

const SCAN_INTERVAL_MS = 120;

export class QrScanner {
  /**
   * @param {HTMLVideoElement} videoEl where the live preview is shown
   * @param {object} options
   * @param {(value: string) => void} options.onResult called once with the decoded text
   * @param {(error: Error) => void} [options.onError]
   */
  constructor(videoEl, { onResult, onError } = {}) {
    this.video = videoEl;
    this.onResult = onResult;
    this.onError = onError;
    this.stream = null;
    this.running = false;
    this._raf = 0;
    this._lastScan = 0;
    this._detector = null;
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    this._done = false;
  }

  static get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && (window.BarcodeDetector || window.jsQR));
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('camera-unsupported');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }

    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play().catch(() => {});

    if (window.BarcodeDetector) {
      try {
        this._detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        this._detector = null;
      }
    }

    this.running = true;
    this._done = false;
    this._loop(performance.now());
  }

  _loop(ts) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((next) => this._loop(next));
    if (ts - this._lastScan < SCAN_INTERVAL_MS) return;
    this._lastScan = ts;
    this._scanFrame();
  }

  async _scanFrame() {
    if (this._done || !this.video.videoWidth) return;
    try {
      let value = null;
      if (this._detector) {
        const codes = await this._detector.detect(this.video);
        if (codes && codes.length) value = codes[0].rawValue;
      } else if (window.jsQR) {
        value = this._scanWithJsQr();
      }
      if (value) this._finish(value);
    } catch {
      // Detection is best effort; a bad frame is simply skipped.
    }
  }

  _scanWithJsQr() {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return null;
    // Cap the analysis size: full-resolution frames are slow and unnecessary.
    const scale = Math.min(1, 640 / Math.max(w, h));
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    if (this._canvas.width !== cw || this._canvas.height !== ch) {
      this._canvas.width = cw;
      this._canvas.height = ch;
    }
    this._ctx.drawImage(this.video, 0, 0, cw, ch);
    const image = this._ctx.getImageData(0, 0, cw, ch);
    const result = window.jsQR(image.data, cw, ch, { inversionAttempts: 'dontInvert' });
    return result?.data ?? null;
  }

  _finish(value) {
    if (this._done) return;
    this._done = true;
    const text = String(value || '').trim();
    this.stop();
    this.onResult?.(text);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    try {
      this.video.srcObject = null;
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pull an 8-digit pairing code out of a scanned string. Accepts a bare code or
 * a full URL containing `?code=XXXXXXXX` (or `#code=`).
 */
export function extractCode(text) {
  if (!text) return null;
  const urlMatch = /[?&#]code=([0-9]{4,12})/i.exec(text);
  const candidate = urlMatch ? urlMatch[1] : text.replace(/\D/g, '');
  const digits = (candidate.match(/\d/g) || []).join('');
  return digits.length === 8 ? digits : null;
}
