// Signaling adapter B: public MQTT brokers over WebSocket (the backup).
//
// Used automatically when PeerJS is unreachable or times out. Public brokers
// are shared with the whole internet, so two things are non-negotiable:
//
//   1. The topic is derived from a SHA-256 hash of the pairing code, never the
//      code itself, so the broker cannot learn the code.
//   2. Every setup message is encrypted with AES-GCM using a key derived from
//      the code with PBKDF2 (random salt, many iterations). Anyone listening on
//      the broker only sees ciphertext.
//
// There is one small unavoidable exception: the random salt has to be shared,
// so the host sends it in an unencrypted "hello" message. A salt is not a
// secret, and publishing it does not help an attacker who does not already
// know the code.
//
// Other rules: no retained messages, messages are ignored once the session is
// established, and the topic is unsubscribed as soon as pairing is done.

import { MQTT_BROKERS, MQTT_CONFIG } from '../config.js';
import { SignalingBase } from './rtc.js';
import {
  codeToTopicHash,
  deriveSignalingKey,
  decryptJson,
  encryptJson,
  randomBytes,
  bytesToBase64,
  base64ToBytes,
} from './crypto.js';

export class MqttSignaling extends SignalingBase {
  constructor(options) {
    super(options);
    this.client = null;
    this.brokerUrl = null;
    this.key = null;
    this.salt = null;
    this.established = false;

    this._subscribedTopic = null; // topic we listen on
    this._publishTopic = null; // topic we talk on
    this._helloTimeout = null;
  }

  async start() {
    const hash = await codeToTopicHash(this.code);
    // The host listens to what the guest publishes and vice versa.
    this._subscribedTopic =
      this.role === 'host'
        ? `${MQTT_CONFIG.topicPrefix}/${hash}/guest`
        : `${MQTT_CONFIG.topicPrefix}/${hash}/host`;
    this._publishTopic =
      this.role === 'host'
        ? `${MQTT_CONFIG.topicPrefix}/${hash}/host`
        : `${MQTT_CONFIG.topicPrefix}/${hash}/guest`;

    try {
      this.client = await this._connectToFirstBroker();
    } catch (err) {
      this.emit('error', { code: 'errors.allServicesUnreachable', error: err });
      this.emit('unreachable', { reason: 'mqtt-all-failed' });
      return;
    }

    this.client.on('message', (topic, payload) => this._onMessage(payload));
    this.client.on('error', (err) => this.emit('error', { code: 'errors.signalingUnreachable', error: err }));
    this.client.on('close', () => {
      if (!this.established && !this.closed) this.emit('close');
    });

    await new Promise((resolve) => {
      this.client.subscribe(this._subscribedTopic, { qos: 0 }, () => resolve());
    });

    if (this.role === 'guest') {
      // The guest goes first. It has to wait for the host's salt before it can
      // encrypt anything, so we do not report "ready" yet.
      this.client.publish(this._publishTopic, JSON.stringify({ t: 'hello', v: 1 }), {
        qos: 0,
        retain: false,
      });
      this._armHelloTimeout();
    } else {
      // The host is listening. It will answer the guest's hello with the salt.
      this.emit('ready');
    }
  }

  _armHelloTimeout(timeoutMs = 15000) {
    this._helloTimeout = setTimeout(() => {
      if (!this.key) {
        this.emit('error', { code: 'errors.wrongOrExpiredCode' });
        this.emit('fatal', { code: 'errors.wrongOrExpiredCode' });
      }
    }, timeoutMs);
  }

  async _connectToFirstBroker() {
    let lastError = null;
    for (const url of MQTT_BROKERS) {
      try {
        const client = await this._connectBroker(url);
        this.brokerUrl = url;
        return client;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('no brokers configured');
  }

  _connectBroker(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let client;
      const clientId = 'linkdrop-' + bytesToBase64(randomBytes(9)).replace(/[^a-zA-Z0-9]/g, '');

      try {
        client = window.mqtt.connect(url, {
          clientId,
          clean: true,
          reconnectPeriod: 0, // we handle retries ourselves
          connectTimeout: MQTT_CONFIG.connectTimeoutMs,
          keepalive: 30,
        });
      } catch (err) {
        reject(err);
        return;
      }

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          client.end(true);
        } catch {
          /* ignore */
        }
        reject(new Error('timeout ' + url));
      }, MQTT_CONFIG.connectTimeoutMs);

      client.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(client);
      });

      client.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          client.end(true);
        } catch {
          /* ignore */
        }
        reject(err);
      });
    });
  }

  async _onMessage(payload) {
    if (this.established || this.closed) return;

    let message;
    try {
      message = JSON.parse(payload.toString());
    } catch {
      return; // not our message
    }

    // --- Handshake (the only unencrypted step). ---
    if (message?.t === 'hello') {
      if (this.role === 'host') {
        // The host answers the guest's hello with a fresh random salt so both
        // sides derive the identical key.
        if (!this.salt) {
          this.salt = randomBytes(16);
          this.key = await deriveSignalingKey(
            this.code,
            this.salt,
            MQTT_CONFIG.pbkdf2Iterations,
          );
          this.client.publish(
            this._publishTopic,
            JSON.stringify({
              t: 'hello',
              v: 1,
              salt: bytesToBase64(this.salt),
              iters: MQTT_CONFIG.pbkdf2Iterations,
            }),
            { qos: 0, retain: false },
          );
        }
      } else if (message.salt && !this.key) {
        // The guest can only derive the key once it has the host's salt.
        this._onHostHello(message);
      }
      return;
    }

    // --- Encrypted setup messages. ---
    if (!message?.iv || !message?.d || !this.key) return;

    try {
      const decoded = await decryptJson(this.key, message);
      if (this.established) return; // ignore anything that races with setup
      this.emit('signal', decoded);
    } catch {
      // Wrong code or tampered message: stay silent. A real listener on a
      // public broker learns nothing either way.
    }
  }

  /** Guest side: derive the key from the salt carried in the host's hello. */
  _onHostHello(message) {
    this.salt = base64ToBytes(message.salt);
    deriveSignalingKey(
      this.code,
      this.salt,
      message.iters || MQTT_CONFIG.pbkdf2Iterations,
    ).then((key) => {
      this.key = key;
      clearTimeout(this._helloTimeout);
      this.emit('ready');
    });
  }

  send(message) {
    if (this.established || !this.key) return;
    encryptJson(this.key, message).then((envelope) => {
      if (this.established || !this.client) return;
      this.client.publish(this._publishTopic, JSON.stringify(envelope), {
        qos: 0,
        retain: false, // never retain on a public broker
      });
    });
  }

  /** Called by the session once the peer-to-peer link is up. */
  markEstablished() {
    this.established = true;
    clearTimeout(this._helloTimeout);
    // Unsubscribe and drop the broker connection: signaling is over.
    const finish = () => {
      try {
        this.client?.end(true);
      } catch {
        /* ignore */
      }
    };
    if (this.client && this._subscribedTopic) {
      this.client.unsubscribe(this._subscribedTopic, finish);
    } else {
      finish();
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this._helloTimeout);
    try {
      this.client?.end(true);
    } catch {
      /* ignore */
    }
    this.client = null;
  }
}

/** Factory used by the app shell. */
export function createMqttSignaling(options) {
  return new MqttSignaling(options);
}

/** True when the mqtt bundle was actually loaded from /vendor. */
export function mqttAvailable() {
  return typeof window !== 'undefined' && typeof window.mqtt === 'object';
}
