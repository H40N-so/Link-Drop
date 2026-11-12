// LinkDrop configuration.
//
// This is the only file most people need to edit. Everything in here is public
// and is shipped to the browser, so never put secrets, personal data or
// certificates in it.
//
// The file is loaded as an ES module (it uses `export const`), so keep the
// syntax valid.

/* --------------------------------------------------------------------------
 * 1. ICE servers
 * --------------------------------------------------------------------------
 * STUN lets two devices behind NAT discover their public address. The public
 * Google STUN servers below are fine for most home/office networks and for
 * two devices on the same Wi-Fi.
 *
 * TURN is only needed when the two devices cannot reach each other directly
 * (for example phone on mobile data, laptop behind a strict firewall, or
 * symmetric NAT). TURN relays the traffic and therefore costs bandwidth.
 *
 * To use your own TURN server, uncomment the TURN entry below and fill in the
 * url, username and credential. The empty entry is intentionally left here as
 * documentation. You can list several TURN servers; they are tried in order.
 */
export const ICE_SERVERS = [
  // Several well-known public STUN servers. Having more than one means a
  // single unreachable host does not break discovery.
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:global.stun.twilio.com:3478' },

  // --- TURN (optional) -----------------------------------------------------
  // Add your own TURN server here for connections across different networks
  // (phone on mobile data, strict firewalls, symmetric NAT).
  // { urls: 'turn:turn.example.com:3478', username: '', credential: '' },
  // { urls: 'turns:turn.example.com:5349', username: '', credential: '' },
];

/* --------------------------------------------------------------------------
 * 2. WebRTC tuning
 * --------------------------------------------------------------------------
 * `maxBufferedAmount` is how many bytes of file data we allow to sit in the
 * data channel buffer before we wait. Keeping this small is what keeps memory
 * usage flat during multi-gigabyte transfers.
 */
export const RTC_CONFIG = {
  // Bytes queued on the file channel before the sender pauses.
  maxBufferedAmount: 4 * 1024 * 1024,
  // Resume sending once the buffer drops below this.
  lowWaterMark: 1 * 1024 * 1024,
  // Preferred chunk size. Clamped to the connection's real max message size.
  chunkSize: 64 * 1024,
};

/* --------------------------------------------------------------------------
 * 3. PeerJS signaling server (Adapter A, the default)
 * --------------------------------------------------------------------------
 * By default we use the free public PeerJS Cloud server. It only carries the
 * setup messages (offer, answer, ICE candidates) and is left untouched once
 * the peer-to-peer connection is up.
 *
 * To run your own PeerJS server (recommended for heavy use) set `useCloud`
 * to false and fill in the host/port/path of your server.
 */
export const PEERJS_CONFIG = {
  useCloud: true, // true -> public PeerJS Cloud, false -> your own server
  host: '', // e.g. 'peerjs.mydomain.com' (no protocol, no slashes)
  port: 443,
  path: '/', // e.g. '/' or '/myapp'
  key: 'peerjs', // PeerJS server key, 'peerjs' for the public cloud
  secure: true, // use wss/https

  // How long we wait for the PeerJS server before falling back to MQTT.
  timeoutMs: 8000,
};

/* --------------------------------------------------------------------------
 * 4. Backup signaling (experimental, off by default)
 * --------------------------------------------------------------------------
 * LinkDrop pairs through PeerJS Cloud. It can additionally fall back to public
 * MQTT brokers when PeerJS is unreachable, but that path is EXPERIMENTAL and
 * therefore disabled by default:
 *
 *   - public brokers are shared with the whole internet and may be
 *     rate-limited, unreliable or disappear at any time;
 *   - the handshake adds moving parts at exactly the moment things are already
 *     going wrong.
 *
 * Set ENABLE_BACKUP_SIGNALING to true to turn the fallback on. While it is
 * false, no MQTT library or adapter code is loaded, the app uses PeerJS only,
 * and the runtime UI never mentions a backup service.
 */
export const ENABLE_BACKUP_SIGNALING = false;

/*
 * The brokers below are used only when ENABLE_BACKUP_SIGNALING is true. They
 * are tried in order with a short timeout. Signaling messages published here
 * are always encrypted (AES-GCM, key derived from the pairing code), and the
 * topic contains only a hash of the code, never the code itself.
 */
export const MQTT_BROKERS = [
  // Public EMQX broker.
  'wss://broker.emqx.io:8084/mqtt',
  // Eclipse Paho public sandbox broker.
  'wss://mqtt.eclipseprojects.io:443/mqtt',
  // HiveMQ public broker.
  'wss://broker.hivemq.com:8884/mqtt',
  // Mosquitto test broker (run by the Mosquitto project).
  'wss://test.mosquitto.org:8081/mqtt',
];

export const MQTT_CONFIG = {
  // How long to wait for a single broker before trying the next one.
  connectTimeoutMs: 6000,
  // Topic namespace. Change it if you run your own broker.
  topicPrefix: 'linkdrop/v1',
  // PBKDF2 iterations for the signaling encryption key.
  pbkdf2Iterations: 200000,
};

/* --------------------------------------------------------------------------
 * 5. Session rules
 * --------------------------------------------------------------------------
 */
export const SESSION_CONFIG = {
  // Pairing codes expire after this long.
  codeTtlMs: 10 * 60 * 1000,
  // Length of the pairing code.
  codeLength: 8,
  // How long we wait for the peer-to-peer link to come up before reporting a
  // connection timeout (the ICE failure message points at TURN).
  connectTimeoutMs: 20000,
  // Try an ICE restart this many times before giving up. An ICE restart
  // re-gathers candidates without tearing the session down, which fixes the
  // common "connection dropped after a network change" case.
  iceRestartMaxAttempts: 2,
  // Grace period after ICE goes to "disconnected" before we treat it as lost.
  disconnectedGraceMs: 5000,
  // Reconnect backoff.
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 15000,
};

/* --------------------------------------------------------------------------
 * 6. Connection check tool (Help page)
 * --------------------------------------------------------------------------
 * Timeouts used by the one-click "Connection check".
 */
export const CHECK_CONFIG = {
  // Per-service timeout for the PeerJS server and each MQTT broker.
  serviceTimeoutMs: 6000,
  // How long to wait for STUN candidates while gathering.
  stunTimeoutMs: 6000,
  // Overall cap for a single run.
  overallTimeoutMs: 30000,
};
