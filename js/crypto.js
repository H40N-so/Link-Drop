// Cryptography helpers for LinkDrop.
//
// Everything here is built on the Web Crypto API (window.crypto.subtle), which
// requires a secure context (https:// or http://localhost). No third party
// crypto libraries are used.
//
// Two independent jobs live in this file:
//   1. Generating the pairing code and turning it into a verification number.
//   2. Encrypting the MQTT backup signaling messages so the public broker
//      (and anyone else listening on it) only sees ciphertext.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/* ------------------------------------------------------------------ *
 * Base64 <-> bytes
 * Signaling messages are tiny, so a simple base64 helper is enough.
 * ------------------------------------------------------------------ */

/** Encode an ArrayBuffer/TypedArray as a base64 string. */
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  // Build in small blocks so we never blow the argument limit of fromCharCode.
  const block = 0x8000;
  for (let i = 0; i < view.length; i += block) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + block));
  }
  return btoa(binary);
}

/** Decode a base64 string back into a Uint8Array. */
export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Random helpers
 * ------------------------------------------------------------------ */

/** Cryptographically secure random bytes. */
export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate a numeric pairing code.
 *
 * The first digit is forced to 1-9 so the code always has exactly `length`
 * digits (no accidental leading zero that a user might drop when typing).
 * Values come from crypto.getRandomValues, never Math.random.
 */
export function generatePairingCode(length = 8) {
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  let out = '';
  for (let i = 0; i < length; i++) {
    // Map 0-255 onto 0-9. The tiny modulo bias is irrelevant for a code that
    // is valid for ten minutes and rate limited by the human typing it.
    let d = digits[i] % 10;
    if (i === 0 && d === 0) d = 1 + (digits[i] % 9); // 1-9
    out += String(d);
  }
  return out;
}

/** Normalise a user typed code: strip everything that is not a digit. */
export function normalizeCode(input) {
  return String(input || '').replace(/\D+/g, '');
}

/** Render "48217035" as "4821 7035" for display. */
export function formatCode(code) {
  const c = normalizeCode(code);
  if (c.length <= 4) return c;
  return c.slice(0, 4) + ' ' + c.slice(4);
}

/* ------------------------------------------------------------------ *
 * Hashing
 * ------------------------------------------------------------------ */

/** SHA-256 of a string, returned as lowercase hex. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive a fixed, non-guessable MQTT topic component from the pairing code.
 * Only a hash of the code is ever published to the broker.
 */
export async function codeToTopicHash(code) {
  return (await sha256Hex('linkdrop-topic|' + normalizeCode(code))).slice(0, 32);
}

/* ------------------------------------------------------------------ *
 * Verification number (pairing safety)
 * ------------------------------------------------------------------ */

/**
 * Compute the 4-digit verification number shown on both devices.
 *
 * The value is derived from the two DTLS certificate fingerprints of the
 * peer-to-peer connection. Both ends see the same pair of fingerprints, so
 * both compute the same number. An attacker sitting in the middle would have
 * two separate connections with two different fingerprint pairs, so the
 * numbers on the two screens would differ — that is exactly what the user is
 * asked to check.
 *
 * The two fingerprints are sorted before hashing so that each side, which
 * knows both but in opposite roles, arrives at the same value.
 */
export async function computeVerificationNumber(fingerprintA, fingerprintB) {
  const parts = [String(fingerprintA || ''), String(fingerprintB || '')]
    .map((s) => s.trim().toLowerCase())
    .sort();
  const digest = await sha256Hex('linkdrop-verify|' + parts.join('|'));
  // Take four bytes and fold them into 0000-9999.
  const n = parseInt(digest.slice(0, 8), 16) % 10000;
  return String(n).padStart(4, '0');
}

/* ------------------------------------------------------------------ *
 * AES-GCM encryption for MQTT signaling
 * ------------------------------------------------------------------ */

const PBKDF2_ITERATIONS = 200000; // overridden by config when available

/**
 * Derive a 256-bit AES-GCM key from the pairing code and a random salt.
 *
 * PBKDF2 with a large iteration count makes it expensive to brute force the
 * eight-digit code from anything captured off the public broker.
 */
export async function deriveSignalingKey(code, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(normalizeCode(code)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a small JSON object with AES-GCM using a fresh random IV.
 * Returns a compact object safe to publish: { iv, d } (both base64).
 */
export async function encryptJson(key, value) {
  const iv = randomBytes(12); // GCM standard nonce length
  const plaintext = textEncoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: bytesToBase64(iv), d: bytesToBase64(ciphertext) };
}

/**
 * Decrypt a { iv, d } envelope produced by encryptJson.
 * Throws if the data was tampered with or the key is wrong.
 */
export async function decryptJson(key, envelope) {
  const iv = base64ToBytes(envelope.iv);
  const data = base64ToBytes(envelope.d);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(textDecoder.decode(plaintext));
}

/** True when the browser exposes the Web Crypto APIs LinkDrop needs. */
export function assertCryptoAvailable() {
  const available =
    typeof crypto !== 'undefined' &&
    crypto.subtle &&
    typeof crypto.getRandomValues === 'function';
  if (!available) {
    throw new Error(
      'Web Crypto is not available. LinkDrop must be served over https:// or http://localhost.',
    );
  }
  return true;
}
