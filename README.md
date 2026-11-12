# LinkDrop

Connect a phone to a laptop through the browser. The laptop can watch the phone's
camera live, and both devices can send files to each other. Everything travels
**directly between the two devices over WebRTC** — there is no backend of our own
and no account, and nothing is uploaded to a server.

LinkDrop is a set of plain static files (HTML, CSS, vanilla ES modules). There is
no build step, no framework and no bundler, so it runs on any static host:
Vercel, GitHub Pages, Netlify, an S3 bucket or a folder on your laptop.

- **Live camera** — phone to laptop, with snapshot, recording, fullscreen,
  mirror, picture-in-picture and live stats.
- **File transfer** — both directions, chunked with backpressure so multi-GB
  files never exhaust memory.
- **Remote controls** — switch camera, resolution and frame rate, toggle the
  torch, turn the microphone on.
- **Safe pairing** — an 8-digit code (or a QR code) plus a 4-digit verification
  number derived from both devices' certificates.
- **Easy phone entry** — scanning the QR code connects straight away, and typing
  the code is just as quick.
- **Connection check** — a one-click test on both Help pages that reports whether
  PeerJS and STUN are reachable and which connection types (direct / server
  reflexive / relay) your device can gather.

## Features

### Pairing

The laptop opens on a calm Connect page: a short hero line, a glass card with the
large 8-digit code (grouped 4–4) and a slim countdown for its expiry, and a
three-step guide with icons — *scan or type the code*, *allow camera access on the
phone*, *match the 4 digits* — whose active step follows the connection. A white
QR card sits alongside it. There is no link to the phone page. On the phone there
are two equally quick ways in:

- **Scan the QR code.** The QR points at `phone.html?code=XXXXXXXX`; scanning it
  opens the phone page with the code already filled in and connects straight
  away, with no extra tap. The in-page scanner uses the rear camera and prefers
  the browser's built-in `BarcodeDetector`, falling back to a vendored `jsQR`.
- **Type the code.** A large 8-digit numeric input, grouped as 4–4, that
  auto-advances, supports paste and submits as soon as the eighth digit lands.

If the pairing service cannot be reached, the screen shows a clear error with a
**Retry** button and a short hint, and the code input stays usable. Opening
`index.html` on a phone redirects to `phone.html`; opening `phone.html` on a
desktop-class device shows a short "this page is for your phone" message and does
not start pairing.

Once a phone is accepted, the Connect card transitions into a **Connected** card:
a success check, the phone's device name, whether the link is **local network** or
**relayed**, the current **latency**, and quick actions — **Open camera**,
**Send files** and **Disconnect**. The phone shows its own friendly status card
with the laptop name and the stream status.

All icons come from a single vendored Lucide-style line-icon sprite
(`vendor/icons/icons.svg`) so their stroke weight and grid match everywhere.

### Camera (phone → laptop)

- Live video player with **Snapshot** (PNG), **Record** (WebM, running timer),
  **Fullscreen**, **Mirror**, **Picture-in-Picture** and a collapsible **stats**
  panel (resolution, frame rate, bitrate).
- Remote controls sent over the control data channel: **front/back camera**,
  **resolution** (360p / 720p / 1080p), **frame rate** (15 / 30 / 60 when the
  phone supports it), **torch** (only shown when available) and an optional
  **microphone** (off by default).
- The phone uses the **Screen Wake Lock** API while streaming and shows a small
  status screen ("Streaming to …", current camera, Stop button).

### Files (both directions)

- Phone: a file picker with `multiple` accepting all types (photos, videos, …).
- Laptop: **drag and drop** and a file picker.
- Transfers use a dedicated data channel in **64 KB chunks** with proper
  backpressure (`bufferedAmountLowThreshold`).
- The receiver streams straight to disk with the **File System Access API** when
  available, otherwise it assembles a Blob and triggers a download.
- A transfer list shows direction, name, size, progress, speed, ETA and status
  (queued, sending, done, failed) with **cancel** and **retry**, plus a session
  history.
- A browser cannot browse your phone's whole storage — you choose what to send.

### Help

A short Help page covers how pairing works, using a USB cable (Android USB
tethering / iPhone Personal Hotspot over USB), Wi-Fi tips, troubleshooting and
the privacy note.

### Connection check

Both the laptop and the phone Help pages have a **Connection check** button. One
click runs a quick, non-destructive test and shows a pass/fail row per item:

- the **PeerJS** pairing server,
- **STUN** reachability,
- the **ICE candidate types** this device could gather — direct (host), server
  reflexive (through STUN) and relay (through a TURN server).

(The optional, experimental backup signaling adds one row per MQTT broker; see
[Backup signaling](#backup-signaling-experimental).)

A closing line explains in plain language what kind of connection is likely to
work from the current network, so you know whether to try the same Wi-Fi or to
add a TURN server.

## How it works

```
        laptop (index.html)                         phone (phone.html)
        ┌───────────────────┐                       ┌───────────────────┐
        │  ui.js  (shell)   │                       │  ui.js  (shell)   │
        │   ├─ camera.js    │                       │   ├─ camera.js    │
        │   └─ files.js     │                       │   └─ files.js     │
        │        │          │                       │        │          │
        │        ▼          │                       │        ▼          │
        │   rtc.js (RTCSession) ─── WebRTC P2P ────► rtc.js (RTCSession) │
        │        │          │   video + data        │        │          │
        │        ▼          │   channels            │        ▼          │
        │ signaling-*.js    │                       │ signaling-*.js    │
        └───────┬───────────┘                       └───────┬───────────┘
                │                                           │
                └────────► signaling only (offer / ◄─────────┘
                           answer / ICE candidates)

        Adapter A: PeerJS Cloud (default)
        offer/answer/ICE are just small JSON messages; the rest of the app never
        knows which adapter is in use.
```

`js/rtc.js` is the single shared WebRTC layer: one `RTCPeerConnection`, one
video track, one reliable `control` data channel and one `files` data channel.
The camera and file modules only ever talk to `RTCSession`, never to a signaling
method, which is why the two adapters are interchangeable.

Signaling is only used to exchange the SDP offer/answer and ICE candidates. Once
the peer-to-peer connection is up, the signaling channel is closed and the two
devices talk to each other directly.

### Signaling

**PeerJS Cloud (default).** The laptop registers itself under the id
`linkdrop-<code>`; the phone connects to that id and the two exchange the offer,
answer and ICE candidates over that connection. That is the only pairing path
the app uses out of the box.

### Backup signaling (experimental)

`js/signaling-mqtt.js` also contains an adapter that falls back to public MQTT
brokers when PeerJS is unreachable. It is **experimental and disabled by
default**: public brokers are shared with the whole internet, may be
rate-limited and can disappear at any time. While it is disabled, no MQTT
library or adapter code is loaded, the app uses PeerJS only, the Connection check
shows no broker rows, and nothing in the interface mentions a backup service.

To enable it, set the flag in `config.js`:

```js
export const ENABLE_BACKUP_SIGNALING = true;
```

When enabled, the fallback uses the first reachable broker from `MQTT_BROKERS`.
The topic is a **SHA-256 hash of the code** (`linkdrop/v1/<hash>/host` and
`…/guest`), never the plain code, and every signaling message is **encrypted with
AES-GCM** using a key derived from the code with PBKDF2 (random salt, many
iterations). Messages are not retained, are ignored once the session is
established, and the topic is unsubscribed after pairing.

### The verification number

After the peer-to-peer connection is up, both screens show the **same 4-digit
number**, computed from the two DTLS certificate fingerprints. The laptop asks
"Allow this device to connect?" and shows the phone's device name and the number;
the phone shows the same number with "Check that this number matches the one on
your laptop". The session only becomes active once the laptop user accepts. If
the numbers differ, someone may be intercepting the connection — press Deny and
try again.

## Deploying

Everything is static, so deployment is just "serve the folder". Two easy hosts:

### Vercel

1. Push this repository to GitHub (or GitLab / Bitbucket).
2. In Vercel, choose **Add New → Project → Import Git Repository** and pick the
   repository.
3. Leave the framework preset as **Other**. **No build command is needed** and
   the output directory is the repository root.
4. Deploy. `vercel.json` already enables `cleanUrls`, serves `/phone` from
   `phone.html` and adds sensible security headers (including
   `Permissions-Policy: camera=(self)`).

### GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages** and set the source to the branch and folder that
   contain these files (usually `main` / `/root`).
3. Open the published URL. The `.nojekyll` file tells GitHub Pages to serve the
   files as-is.

Because every path in the app is relative (no leading slashes), LinkDrop also
works when it is **not** at the domain root, for example
`https://example.com/tools/linkdrop/`.

### Local preview

Serve the folder over `http://localhost` (a secure context, so the camera works):

```bash
npx serve .          # or: python3 -m http.server 8080
```

Then open `http://localhost:8080` on the laptop and scan the QR code with the
phone (or open `http://localhost:8080/phone.html` on the phone and type the
code).

## Configuration (`config.js`)

`config.js` is the only file most people need to edit. It is shipped to the
browser, so never put secrets in it.

### Change the PeerJS server

By default LinkDrop uses the public PeerJS Cloud server. To use your own:

```js
export const PEERJS_CONFIG = {
  useCloud: false,
  host: 'peerjs.example.com', // no protocol, no slashes
  port: 443,
  path: '/',
  key: 'peerjs',
  secure: true,
  timeoutMs: 8000,
};
```

### Backup signaling and the MQTT broker list

The backup is **off by default**; turn it on with:

```js
export const ENABLE_BACKUP_SIGNALING = true;
```

Only then are `MQTT_BROKERS` used, and only when PeerJS is unreachable. Public
brokers may change, rate-limit or disappear at any time and are shared with the
whole internet, so treat them as best-effort. They are tried in order with a
short timeout:

```js
export const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  // add or remove brokers here
];
```

### Add a TURN server

STUN is enough when both devices are on the same network. For connections across
different networks (phone on mobile data, a strict firewall, symmetric NAT) add
your own TURN server in `ICE_SERVERS`:

```js
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  // --- TURN (optional) ---
  { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
  { urls: 'turns:turn.example.com:5349', username: 'user', credential: 'pass' },
];
```

## Known limitations

- **Only one phone at a time** per laptop/code.
- A pairing **code expires after 10 minutes**; generate a new one after that.
- **A browser cannot browse a phone's whole storage.** The user picks files to
  send.
- The **File System Access API** (streaming received files straight to disk) is
  currently available only in Chromium-based browsers; other browsers fall back
  to assembling a Blob and downloading it.
- **Recording** uses `MediaRecorder`, so the produced file depends on the browser
  (WebM in Chromium/Firefox, and Safari may differ).
- **Picture-in-Picture**, **torch** and **60 fps** depend on the phone/browser and
  are hidden or disabled when unsupported.
- Public signaling services (PeerJS Cloud, and the experimental MQTT backup) can
  be slow or unavailable; for heavy use host your own PeerJS server.
- Both devices must be on a **secure context** (`https://` or `http://localhost`).

## Troubleshooting

- **Camera does not start** — allow camera access for the site, close other apps
  that use the camera, and reload.
- **Devices on different networks won't connect** — add a TURN server in
  `config.js`. STUN alone cannot always traverse mobile networks or strict NAT.
- **Not sure what will work here?** — open the **Help** page on either device and
  run the **Connection check**. It tells you which services are reachable and
  which connection types your network allows.
- **Corporate network or VPN** — these often block WebRTC. Try USB tethering or
  another network.
- **A transfer failed** — keep both screens open and retry. Large transfers need
  both devices to stay awake.
- **"The pairing service could not be reached"** — LinkDrop failed to reach
  PeerJS. Check your connection and press **Retry** on the connect screen.

## Privacy

Video and files travel directly between the two devices and are never uploaded to
a server. The pairing service only ever sees encrypted setup messages — and, when
the experimental MQTT backup is enabled, only a hash of the pairing code — never
your files or video.

## License

[MIT](LICENSE)
