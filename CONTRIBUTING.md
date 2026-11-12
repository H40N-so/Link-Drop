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

Open the laptop page and the phone page, or use two browser tabs. To test the
MQTT backup adapter, block the PeerJS server (for example with your browser's
devtools request blocking) and confirm LinkDrop switches over automatically.

## Project layout

```
index.html            laptop shell
phone.html            phone shell
config.js             the file most users edit (ICE, PeerJS, MQTT, session rules)
css/theme.css         colour tokens, light/dark, fonts
css/app.css           layout and components
js/rtc.js             shared WebRTC layer (the only file that owns RTCPeerConnection)
js/signaling-peerjs.js  Adapter A
js/signaling-mqtt.js    Adapter B
js/crypto.js          code generation, PBKDF2 + AES-GCM, verification number
js/camera.js          camera publisher (phone) and viewer (laptop)
js/files.js           file transfer both directions
js/settings.js        persisted settings + Settings screen
js/i18n.js            English and Indonesian strings
js/ui.js              app shell: routing, pairing flow, verification, reconnect
vendor/               pinned third-party libraries and fonts
```

## Style

- Vanilla ES modules, `const`/`let`, no semicolon-free code.
- Keep memory flat in hot paths (no per-frame allocations), and keep comments
  where the logic is not obvious.
- Follow the existing visual language: one soft blue accent, neutral grays,
  12–16px rounded corners, thin borders, subtle 150–200ms transitions.
- Keep the interface keyboard accessible with visible focus styles and aria
  labels, and add new strings to **both** `en` and `id` in `js/i18n.js`.

## Submitting changes

1. Fork the repository and create a branch.
2. Make your change and test it on a laptop and a phone (or two devices in the
   same browser).
3. Open a pull request with a short description of what it does and why.

By contributing you agree that your work is licensed under the MIT License.
