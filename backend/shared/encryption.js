/**
 * @module @hms/shared/encryption
 *
 * Application-level symmetric field encryption for sensitive patient data
 * (PII / PHI) using **AES-256-GCM** authenticated encryption.
 *
 * This module is the primitive that backend services use to encrypt individual
 * fields (for example a patient's national identifier, contact details, or a
 * structured PII blob) *before* they are persisted, and to decrypt them after
 * they are read. It **complements — and does NOT replace — the database-level
 * `pgcrypto` encryption** owned by the `../database/` layer:
 *
 *   - Per `03_Hospital_Management_Technical_Architecture.pdf`
 *     (Security Architecture → "Encrypted patient data storage"), sensitive
 *     patient data must be encrypted at rest.
 *   - Per `05_Hospital_Management_QA_Testing_and_DevOps_Strategy.pdf`
 *     (Security Testing → "Patient data privacy"), patient-data privacy is a
 *     tracked risk that this defense-in-depth layer helps mitigate.
 *
 * This file deliberately contains **no business/domain logic and never touches
 * the database** — it is a stateless cryptographic primitive consumed by the
 * services that own that logic.
 *
 * ## Payload format
 *
 * {@link encrypt} returns a compact, self-describing, URL-safe-ish string:
 *
 *     "v1:" + base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
 *
 *   - `v1`         — version tag, so the scheme can evolve without ambiguity.
 *   - `iv`         — 12-byte random initialization vector, unique per call.
 *   - `authTag`    — 16-byte GCM authentication tag (integrity + authenticity).
 *   - `ciphertext` — the AES-256-GCM ciphertext.
 *
 * The three binary components are base64-encoded; because standard base64 never
 * contains a colon, the four fields can always be recovered by splitting on
 * `":"`.
 *
 * ## Security properties & rules (MUST be preserved)
 *
 *   - **AES-256-GCM only.** GCM is authenticated encryption: tampering with the
 *     IV, tag, or ciphertext causes {@link decrypt} to throw instead of
 *     silently returning corrupted plaintext. Never introduce ECB or any
 *     unauthenticated mode.
 *   - **Fresh random IV per call.** A new 12-byte IV is generated for every
 *     {@link encrypt} call and is never reused, which is mandatory for GCM
 *     security.
 *   - **Built-ins only.** Uses Node's built-in `node:crypto`; no external
 *     dependencies.
 *   - **Secret-safe.** This module never logs (or embeds in error messages) the
 *     encryption key, plaintext, or ciphertext.
 *
 * ## Import-time contract
 *
 * The module is **side-effect-free at import**: it does not read configuration
 * or derive the key when required. The 32-byte key is derived lazily and
 * memoized on the first {@link encrypt} / {@link decrypt} call (see
 * {@link getKey}), which lets a consuming service populate the environment
 * (e.g. via `dotenv`) before any cryptographic work happens.
 *
 * @example
 *   const enc = require("@hms/shared/encryption");
 *   const stored = enc.encrypt("123-45-6789"); // "v1:...:...:..."
 *   const ssn = enc.decrypt(stored);           // "123-45-6789"
 *   enc.isEncrypted(stored);                    // true
 */

"use strict";

const crypto = require("node:crypto");

/**
 * Payload version tag. Bump this (and add a new decode branch) if the on-the-
 * wire format ever changes so that old and new payloads remain distinguishable.
 *
 * @type {string}
 */
const VERSION = "v1";

/**
 * The only cipher this module will ever use: AES-256 in Galois/Counter Mode.
 * GCM provides authenticated encryption (confidentiality + integrity).
 *
 * @type {string}
 */
const ALGORITHM = "aes-256-gcm";

/**
 * AES-256 key size, in bytes (256 bits).
 *
 * @type {number}
 */
const KEY_BYTES = 32;

/**
 * GCM initialization-vector size, in bytes. 12 bytes (96 bits) is the value
 * recommended by NIST SP 800-38D for GCM and is what Node's GCM implementation
 * is optimized for.
 *
 * @type {number}
 */
const IV_BYTES = 12;

/**
 * GCM authentication-tag size, in bytes (128 bits — the full-strength tag).
 *
 * @type {number}
 */
const AUTH_TAG_BYTES = 16;

/**
 * Static salt used by the scrypt key-derivation fallback (see {@link getKey}).
 *
 * The salt is intentionally *static*. This module manages a single, long-lived
 * symmetric application key, so a fixed salt is required to produce a stable
 * derived key across process restarts — a random salt would make previously
 * encrypted values undecryptable after a restart. Because the salt is not
 * secret, embedding it here is acceptable for this use case.
 *
 * Consequence / operational note: rotating `DATA_ENCRYPTION_KEY` changes the
 * derived key and therefore invalidates every value encrypted under the old
 * key. A future `"v2"` payload scheme can embed a per-value salt to enable key
 * rotation / envelope encryption without a bulk re-encrypt.
 *
 * @type {string}
 */
const KDF_SALT = "hms-shared-encryption-v1";

/**
 * Matches a raw key that is exactly 64 hexadecimal characters — i.e. an
 * already-32-byte key expressed in hex. Such a key is used verbatim.
 *
 * @type {RegExp}
 */
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Loose "looks like base64" shape check (standard or URL-safe alphabet, with up
 * to two `=` padding characters). This is only a fast pre-filter; the authoritative
 * validation in {@link tryDecodeBase64Key} decodes the value and verifies it is
 * exactly 32 bytes via a round-trip comparison.
 *
 * @type {RegExp}
 */
const BASE64_SHAPE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Memoized 32-byte encryption key. `null` means "not yet derived". Computed
 * once, lazily, by {@link getKey}.
 *
 * @type {(Buffer|null)}
 */
let cachedKey = null;

/**
 * Attempt to interpret a raw key string as base64 that decodes to exactly
 * {@link KEY_BYTES} (32) bytes.
 *
 * To avoid false positives — arbitrary strings that merely happen to decode to
 * 32 bytes — the candidate must both look like base64 and survive a round-trip:
 * re-encoding the decoded bytes must reproduce the input (ignoring `=` padding
 * and normalizing the URL-safe `-`/`_` alphabet to the standard `+`/`/`).
 *
 * @param {string} raw The raw key string from configuration.
 * @returns {(Buffer|null)} A 32-byte Buffer if `raw` is base64 for exactly 32
 *   bytes; otherwise `null`.
 */
function tryDecodeBase64Key(raw) {
  if (!BASE64_SHAPE_PATTERN.test(raw)) {
    return null;
  }

  // Node's base64 decoder is lenient (it accepts both the standard and URL-safe
  // alphabets and silently drops characters it cannot use), so the length check
  // plus the round-trip guard below are what make this reliable.
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    return null;
  }

  const reencoded = decoded.toString("base64").replace(/=+$/, "");
  const normalizedInput = raw
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "");

  if (reencoded !== normalizedInput) {
    return null;
  }

  return decoded;
}

/**
 * Lazily derive and memoize the 32-byte AES-256 key.
 *
 * The raw key string comes from `config.encryption.key`
 * (the `DATA_ENCRYPTION_KEY` environment variable). It is normalized to exactly
 * 32 bytes using the first matching strategy:
 *
 *   1. **64 hex characters** → used directly as 32 raw bytes.
 *   2. **base64 decoding to exactly 32 bytes** → used directly.
 *   3. **anything else** (e.g. a passphrase, or the `.env.example` default
 *      `"change_me"`) → derived deterministically with
 *      `crypto.scryptSync(rawKey, KDF_SALT, 32)`.
 *
 * `./config` is required lazily *inside* this function (not at module top level)
 * to keep this module side-effect-free at import time and to avoid any
 * load-order coupling with the configuration module.
 *
 * @returns {Buffer} The memoized 32-byte key.
 * @throws {Error} If the configured key is missing or not a non-empty string.
 */
function getKey() {
  if (cachedKey !== null) {
    return cachedKey;
  }

  // Lazy require: `./config` is itself side-effect-free at import and reads the
  // environment only when getConfig() is called, so this is the first point at
  // which any configuration is actually read.
  const { getConfig } = require("./config");
  const rawKey = getConfig().encryption.key;

  if (typeof rawKey !== "string" || rawKey.length === 0) {
    // Do not include the value itself in the message — it is a secret.
    throw new Error(
      "Encryption key is not configured: DATA_ENCRYPTION_KEY must be a " +
        "non-empty string.",
    );
  }

  let derived;
  if (HEX_KEY_PATTERN.test(rawKey)) {
    // 64 hex chars == exactly 32 bytes.
    derived = Buffer.from(rawKey, "hex");
  } else {
    const base64Key = tryDecodeBase64Key(rawKey);
    derived =
      base64Key !== null
        ? base64Key
        : crypto.scryptSync(rawKey, KDF_SALT, KEY_BYTES);
  }

  cachedKey = derived;
  return cachedKey;
}

/**
 * Coerce accepted plaintext inputs to a Buffer, rejecting everything else.
 *
 * Only `string` (encoded as UTF-8) and `Buffer` are accepted. `null` and
 * `undefined` are rejected with an explicit message; any other type is rejected
 * with its type name. Error messages intentionally never contain the value.
 *
 * @param {(string|Buffer)} plaintext The value to encrypt.
 * @returns {Buffer} The plaintext as a Buffer.
 * @throws {TypeError} If `plaintext` is null/undefined or not a string/Buffer.
 */
function toPlaintextBuffer(plaintext) {
  if (plaintext === null || plaintext === undefined) {
    throw new TypeError(
      "encrypt() requires a non-null string or Buffer plaintext; received " +
        (plaintext === null ? "null" : "undefined") +
        ".",
    );
  }

  if (Buffer.isBuffer(plaintext)) {
    return plaintext;
  }

  if (typeof plaintext === "string") {
    return Buffer.from(plaintext, "utf8");
  }

  throw new TypeError(
    "encrypt() requires a string or Buffer plaintext; received type " +
      typeof plaintext +
      ".",
  );
}

/**
 * Encrypt a value with AES-256-GCM and return a self-describing string.
 *
 * A fresh random 12-byte IV is generated for every call, so encrypting the same
 * plaintext twice yields two different (but both valid) payloads.
 *
 * @param {(string|Buffer)} plaintext The value to encrypt. Strings are treated
 *   as UTF-8.
 * @returns {string} A payload of the form
 *   `"v1:" + base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)`.
 * @throws {TypeError} If `plaintext` is null, undefined, or not a string/Buffer.
 */
function encrypt(plaintext) {
  const plaintextBuffer = toPlaintextBuffer(plaintext);

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintextBuffer),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a payload produced by {@link encrypt} and return the UTF-8 plaintext.
 *
 * Any tampering with the payload — flipping a ciphertext bit, altering the IV or
 * authentication tag, or decrypting under a different key — causes the
 * underlying GCM verification to fail and this function to **throw**. That error
 * is intentionally allowed to propagate (it is never swallowed) so that callers
 * cannot mistake corrupted or forged data for a successful decryption.
 *
 * @param {string} payload A `"v1:iv:authTag:ciphertext"` string from
 *   {@link encrypt}.
 * @returns {string} The decrypted UTF-8 plaintext.
 * @throws {TypeError} If `payload` is not a string.
 * @throws {Error} If `payload` is malformed / unsupported, or if GCM
 *   authentication fails (tampered data or wrong key).
 */
function decrypt(payload) {
  if (typeof payload !== "string") {
    throw new TypeError(
      "decrypt() expects a string payload produced by encrypt(); received " +
        "type " +
        typeof payload +
        ".",
    );
  }

  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(
      "decrypt() received a malformed or unsupported payload; expected " +
        '"' +
        VERSION +
        ':<iv>:<authTag>:<ciphertext>".',
    );
  }

  const iv = Buffer.from(parts[1], "base64");
  const authTag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");

  if (iv.length !== IV_BYTES) {
    throw new Error(
      "decrypt() payload has an invalid IV; expected " + IV_BYTES + " bytes.",
    );
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      "decrypt() payload has an invalid authentication tag; expected " +
        AUTH_TAG_BYTES +
        " bytes.",
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  // final() throws if the authentication tag does not verify (i.e. the payload
  // was tampered with or was encrypted under a different key). Let it propagate.
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

/**
 * Cheap structural check for whether a value already looks like an
 * {@link encrypt} payload. Useful so callers can avoid double-encrypting a value
 * that has already been encrypted.
 *
 * This validates shape only (a `"v1:"` prefix followed by four colon-separated
 * fields); it does not attempt decryption and does not require the key. A
 * `true` result therefore means "plausibly an encrypted payload", not
 * "guaranteed to decrypt".
 *
 * The IV and authentication-tag segments are always present and non-empty for a
 * real payload, so both are required to be non-empty here. The ciphertext
 * segment, however, may legitimately be empty: encrypting an empty string
 * produces zero ciphertext bytes (but still a valid authentication tag), so an
 * empty final segment is accepted.
 *
 * @param {*} value Any value.
 * @returns {boolean} `true` if `value` is a string with the expected
 *   `"v1:iv:authTag:ciphertext"` shape.
 */
function isEncrypted(value) {
  if (typeof value !== "string" || !value.startsWith(VERSION + ":")) {
    return false;
  }

  const parts = value.split(":");
  return (
    parts.length === 4 &&
    parts[0] === VERSION &&
    parts[1].length > 0 &&
    parts[2].length > 0
  );
}

/**
 * Convenience wrapper: JSON-serialize `value` and {@link encrypt} the result.
 * Handy for encrypting structured PII blobs.
 *
 * Serialization uses `JSON.stringify` and therefore follows its semantics
 * (e.g. `undefined`, functions, and symbols are dropped from objects). Note
 * that `encryptJSON(undefined)` throws, because `JSON.stringify(undefined)`
 * yields `undefined`, which {@link encrypt} rejects.
 *
 * @param {*} value Any JSON-serializable value.
 * @returns {string} The encrypted payload of the JSON string.
 * @throws {TypeError} If the value serializes to `undefined`.
 * @throws {Error} If the value cannot be serialized (e.g. a circular reference).
 */
function encryptJSON(value) {
  return encrypt(JSON.stringify(value));
}

/**
 * Convenience wrapper: {@link decrypt} `payload` and `JSON.parse` the plaintext.
 * The inverse of {@link encryptJSON}.
 *
 * @param {string} payload A payload previously produced by {@link encryptJSON}
 *   (or by {@link encrypt} wrapping valid JSON).
 * @returns {*} The parsed JavaScript value.
 * @throws {TypeError} If `payload` is not a string.
 * @throws {Error} If decryption fails (see {@link decrypt}) or if the decrypted
 *   plaintext is not valid JSON.
 */
function decryptJSON(payload) {
  return JSON.parse(decrypt(payload));
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  encryptJSON,
  decryptJSON,
};
