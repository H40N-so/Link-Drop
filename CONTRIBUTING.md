# Contributing to LinkDrop

Thanks for your interest. LinkDrop is intentionally small and dependency-light,
and contributions that keep it that way are very welcome.

## Ground rules

- **Static files only.** No build step, no bundler, no framework and no backend.
  A pull request that requires a compile step will be declined.
- **No CDN at runtime.** Third-party libraries are vendored as pinned local files
  in `/vendor` and loaded from there.
- **Relative paths only.** Never use a leading `/` in a path, so the app keeps
  working at a domain root, under a sub-path and on `localhost`.
- **One WebRTC layer.** Features talk to `js/rtc.js` (`RTCSession`); they must
  never talk to a signaling adapter directly. The app must not know whether
  PeerJS or MQTT is in use.
- **No secrets.** Never commit credentials, certificates, tokens or personal
  data.

## Getting started

There is nothing to install to run the app. Serve the folder over
`http://localhost` (a secure context, required for the camera):

```bash
npx serve .          # or: python3 -m http.server 8080
```

Open the laptop page and the phone page, or use two browser tabs. By default the
app pairs through PeerJS only. The MQTT backup adapter is experimental and off
by default; to exercise it, set `ENABLE_BACKUP_SIGNALING = true` in `config.js`
and block the PeerJS server (for example with your browser's devtools request
blocking) to confirm LinkDrop switches over automatically.

### The `?dev=1` override

The two pages are role-separated: `index.html` is the laptop and `phone.html` is
the phone, and each redirects or refuses to run when opened on the "wrong" kind
of device (a phone shows the laptop page only as a redirect, and a desktop shows
the phone page only a "this page is for your phone" message). That is correct for
real users but inconvenient on a single development machine.

For local testing only, append **`?dev=1`** to the URL to bypass the device
checks:

```
http://localhost:8080/phone.html?dev=1     # open the phone UI in a desktop tab
http://localhost:8080/index.html?dev=1     # open the laptop UI on a phone
```

This flag is intentionally **not** mentioned anywhere in the UI and is meant for
development and testing only — do not build product features around it.

### Testing the roles

- **Laptop vs phone** — the laptop only ever shows the code and the QR code; it
  must never contain a button or link that opens the phone page.
- **Phone entry** — the phone connects automatically when the URL carries
  `?code=`, and otherwise shows the landing screen with the 8-digit input and the
  QR scanner. Every state (loading, connecting, verifying, connected, error) must
  have a designed view; the phone should never show a blank screen.
- **Verification** — the 4-digit number must match on both screens before the
  laptop accepts.
- **Connection check** — Help → Connection check should list PeerJS, STUN and the
  gathered ICE candidate types. It only adds a row per MQTT broker when
  `ENABLE_BACKUP_SIGNALING` is true.

## Project layout

```
index.html            laptop shell
phone.html            phone shell
config.js             the file most users edit (ICE, PeerJS, MQTT, session rules)
css/theme.css         colour tokens, light/dark, fonts
css/app.css           layout and components
js/rtc.js             shared WebRTC layer (the only file that owns RTCPeerConnection)
js/signaling-peerjs.js  Adapter A (the default)
js/signaling-mqtt.js    Adapter B (backup, experimental, disabled by default)
js/crypto.js          code generation, PBKDF2 + AES-GCM, verification number
js/device.js          desktop/phone detection for the role separation
js/scanner.js         QR scanner (BarcodeDetector, falling back to vendored jsQR)
js/camera.js          camera publisher (phone) and viewer (laptop)
js/files.js           file transfer both directions
js/settings.js        persisted settings + Settings screen
js/feedback.js        modal / bottom-sheet dialogs and the toast system
js/router.js          screen router (View Transitions API + CSS fallback)
js/checks.js          the Connection check tool
js/i18n.js            English and Indonesian strings
js/ui.js              app shell: routing, pairing flow, verification, reconnect
vendor/               pinned third-party libraries and fonts
```

## Style

- Vanilla ES modules, `const`/`let`, no semicolon-free code.
- Keep memory flat in hot paths (no per-frame allocations), and keep comments
  where the logic is not obvious.
- Follow the existing visual language: one soft blue accent, neutral grays,
  12–16px rounded corners, thin 1px borders, very soft layered shadows, and
  subtle transitions (250–320 ms ease-out for view changes, and always only
  `transform`/`opacity`). Respect `prefers-reduced-motion`.
- Keep the interface keyboard accessible with visible focus styles and aria
  labels, and add new strings to **both** `en` and `id` in `js/i18n.js`.

## Submitting changes

1. Fork the repository and create a branch.
2. Make your change and test it on a laptop and a phone (or two devices in the
   same browser).
3. Open a pull request with a short description of what it does and why.

By contributing you agree that your work is licensed under the MIT License.
