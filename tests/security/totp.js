'use strict';

/**
 * tests/security/totp.js — Pure RFC 6238 (TOTP) generator built on RFC 4226 (HOTP).
 *
 * PURPOSE
 *   Generates time-based one-time passwords so the security/RBAC test harness can
 *   OPTIONALLY complete the multi-factor-authentication (MFA) challenge for the two
 *   privileged HMS roles (Hospital Administrator = `admin`, Doctor = `doctor`) that the
 *   Functional Requirements Specification designates for MFA:
 *     `02_Hospital_Management_Functional_Requirements_Specification` →
 *     Authentication & Authorization → "Multi-factor authentication for privileged users".
 *
 * WHY THIS EXISTS (discovery finding)
 *   The demo seed (`database/seeds/04_demo_users.sql`) enables `mfa_enabled = true` for
 *   `admin` and `doctor` but seeds NO `mfa_secrets` row. Consequently password login for
 *   those roles ALWAYS returns `{ mfaRequired: true, challenge }` and they cannot obtain a
 *   JWT from seed data alone. When an operator provisions a real base32 TOTP secret for a
 *   privileged role and exposes it to the harness via `TEST_<PREFIX>_TOTP_SECRET`
 *   (e.g. `TEST_ADMIN_TOTP_SECRET`, `TEST_DOCTOR_TOTP_SECRET`) together with
 *   `SECURITY_COMPLETE_MFA=1`, this module derives the current 6-digit code so the
 *   privileged-role RBAC matrix can run end-to-end. This mirrors the env-var contract used
 *   by `tests/fixtures/credentials.js` and `tests/performance/config.js`.
 *
 * DESIGN CONSTRAINTS
 *   - CommonJS module.
 *   - Uses ONLY the Node.js standard library (`node:crypto`). No external dependencies
 *     (deliberately NOT `otplib`/`speakeasy`) so the harness stays dependency-free.
 *   - No import-time side effects: requiring this module only defines constants/functions
 *     and reads no environment, performs no I/O, and logs nothing.
 *
 * STANDARDS
 *   - Base32 decoding: RFC 4648 §6.
 *   - HOTP dynamic truncation: RFC 4226 §5.3–5.4.
 *   - TOTP time-step counter: RFC 6238 §4.
 *
 * SECURITY NOTE
 *   TOTP secrets are DEVELOPMENT/TEST material supplied at runtime via environment
 *   variables. Never commit real secrets to the repository; this module never persists or
 *   logs the secret or the generated code.
 */

const crypto = require('node:crypto');

// RFC 4648 §6 base32 alphabet. Index position == the 5-bit value the symbol encodes.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode an RFC 4648 base32 string into its raw bytes.
 *
 * Accepts operator-friendly formatting: input is upper-cased and any ASCII whitespace,
 * hyphens (common visual grouping such as `GEZD-GNBV-GY3T-QOJQ`) and `=` padding are
 * stripped before decoding. Every remaining character MUST belong to the base32 alphabet.
 *
 * Decoding accumulates 5 bits per input symbol into a small bit buffer and emits one byte
 * for every full 8 bits. Any leftover (< 8) trailing bits are discarded, which is the
 * correct behaviour for canonically padded base32 (the leftover bits are always zero).
 *
 * @param {string} input - The base32-encoded secret (case-insensitive; may contain
 *   whitespace, `-` grouping and `=` padding).
 * @returns {Buffer} The decoded key bytes (empty `Buffer` for empty input).
 * @throws {TypeError} If `input` is not a string.
 * @throws {Error} `Invalid base32 character: <ch>` for any character outside the alphabet.
 */
function base32Decode(input) {
  if (typeof input !== 'string') {
    throw new TypeError(
      'base32Decode: expected a string but received ' + typeof input,
    );
  }

  // Normalise: uppercase, then remove whitespace, hyphen grouping and `=` padding.
  const cleaned = input.toUpperCase().replace(/[\s\-=]/g, '');

  let bits = 0; // number of not-yet-emitted meaningful bits currently held in `value`
  let value = 0; // holds only the low `bits` un-emitted bits (masked each emit)
  const bytes = [];

  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error('Invalid base32 character: ' + ch);
    }

    // Shift in the next 5 bits.
    value = (value << 5) | idx;
    bits += 5;

    // Emit a byte whenever at least 8 bits are available. Masking `value` down to the
    // remaining low bits after each emission keeps it tiny (<= 12 bits) so the `<< 5`
    // never approaches the 32-bit boundary of JS bitwise arithmetic.
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a time-based one-time password (RFC 6238) from a base32 secret.
 *
 * The counter is the number of `period`-second time steps since the Unix epoch (T0 = 0),
 * encoded as an 8-byte big-endian value. An HMAC of that counter (keyed by the decoded
 * secret) is reduced to `digits` decimal digits via RFC 4226 §5.4 dynamic truncation.
 *
 * @param {string} base32Secret - The shared secret, base32-encoded (RFC 4648).
 * @param {object} [options] - Optional overrides.
 * @param {number} [options.digits=6] - Number of output digits (positive integer; 6–8 typical).
 * @param {number} [options.period=30] - Time-step length in seconds (must be > 0).
 * @param {string} [options.algorithm='sha1'] - HMAC hash: 'sha1' | 'sha256' | 'sha512'
 *   (any digest accepted by `crypto.createHmac`).
 * @param {number} [options.timestamp=Date.now()] - Reference time in MILLISECONDS.
 * @returns {string} The zero-padded numeric OTP (length === `digits`).
 * @throws {Error} If the secret is empty/invalid, options are out of range, or the derived
 *   counter is negative (timestamp before the Unix epoch).
 */
function generateTOTP(base32Secret, options = {}) {
  if (typeof base32Secret !== 'string' || base32Secret.trim() === '') {
    throw new Error(
      'generateTOTP: a non-empty base32 secret string is required',
    );
  }

  const {
    digits = 6,
    period = 30,
    algorithm = 'sha1',
    timestamp = Date.now(),
  } = options;

  if (!Number.isInteger(digits) || digits < 1) {
    throw new Error('generateTOTP: "digits" must be a positive integer');
  }
  if (typeof period !== 'number' || !Number.isFinite(period) || period <= 0) {
    throw new Error(
      'generateTOTP: "period" must be a positive number of seconds',
    );
  }
  if (typeof algorithm !== 'string' || algorithm.trim() === '') {
    throw new Error('generateTOTP: "algorithm" must be a non-empty string');
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new Error(
      'generateTOTP: "timestamp" must be a finite number of milliseconds',
    );
  }

  // RFC 6238 §4.2: T = floor((unixSeconds - T0) / period), with T0 = 0.
  const counter = Math.floor(timestamp / 1000 / period);
  if (counter < 0) {
    throw new Error(
      'generateTOTP: "timestamp" must not predate the Unix epoch',
    );
  }

  // Encode the counter as an unsigned 64-bit big-endian integer. Using BigInt correctly
  // handles counters beyond 32 bits (the high bytes are simply zero for current epochs).
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(base32Secret);
  const hmac = crypto.createHmac(algorithm, key).update(counterBuffer).digest();

  // RFC 4226 §5.4 dynamic truncation: the low nibble of the last byte selects a 4-byte
  // window; masking the top bit yields a 31-bit positive integer (no sign issues in JS).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  // Reduce to the requested number of digits and left-pad with zeros.
  const otp = (binCode % 10 ** digits).toString().padStart(digits, '0');
  return otp;
}

/**
 * Convenience wrapper: generate a TOTP only when a secret is actually present.
 *
 * Lets callers stay concise when the secret is optional, e.g.:
 *   `const code = generateTOTPForSecretOrNull(process.env.TEST_ADMIN_TOTP_SECRET);`
 * returns `null` (rather than throwing) whenever no secret was provisioned, so the caller
 * can decide whether MFA completion is possible for the current environment.
 *
 * @param {?string} secretOrNull - A base32 secret, or a falsy value when none is available.
 * @param {object} [options] - Same options as {@link generateTOTP}.
 * @returns {?string} The generated OTP, or `null` when `secretOrNull` is falsy.
 */
function generateTOTPForSecretOrNull(secretOrNull, options = {}) {
  if (!secretOrNull) {
    return null;
  }
  return generateTOTP(secretOrNull, options);
}

module.exports = { generateTOTP, base32Decode, generateTOTPForSecretOrNull };
