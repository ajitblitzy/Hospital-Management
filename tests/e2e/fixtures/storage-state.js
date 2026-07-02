'use strict';

/**
 * @hms/e2e-tests — storage-state helpers for reusable, role-scoped auth.
 *
 * Pure path / filesystem / environment helpers used by the auth fixtures
 * (./test-fixtures.js) to CACHE and REUSE Playwright "storage state" per role,
 * so each of the 8 seeded roles logs in at most once per run instead of
 * re-authenticating in every test.
 *
 * This module deliberately has NO dependency on @playwright/test or the Page
 * Objects — it only decides WHERE and WHETHER a role's session is cached. The
 * actual login (driving ../pages/LoginPage.js, incl. MFA) and the call to
 * `context.storageState({ path })` live in ./test-fixtures.js.
 *
 * PATIENT-DATA PRIVACY / SECURITY (FIRST-CLASS): the cached JSON contains
 * SEEDED, DEV-ONLY session tokens for SYNTHETIC users. It is written under a
 * gitignored `.auth/` directory and must NEVER be committed. Never place real
 * patient PII or production secrets here.
 *
 * CommonJS only (require / module.exports) — no ESM, no TypeScript.
 */

const fs = require('fs');
const path = require('path');

/**
 * Directory where per-role Playwright storage-state JSON is cached.
 *
 * Anchored at the E2E suite root (one level above this `fixtures/` folder, next
 * to `playwright.config.js`), i.e. `tests/e2e/.auth/`. The suite `.gitignore`
 * ignores `.auth/`, so these seeded session files stay out of version control.
 * @type {string}
 */
const AUTH_DIR = path.resolve(__dirname, '..', '.auth');

/**
 * Maximum age a cached storage state may reach before it is considered stale
 * and regenerated. Kept safely BELOW the application's 30-minute idle session
 * timeout so a cached login cannot expire in the middle of a run.
 * @type {number}
 */
const DEFAULT_MAX_AGE_MS = 25 * 60 * 1000;

/**
 * Absolute path to the storage-state file for a role key (e.g. `admin`).
 * @param {string} roleKey One of the @hms/test-fixtures role keys.
 * @returns {string}
 */
function storageStatePath(roleKey) {
  if (!roleKey || typeof roleKey !== 'string') {
    throw new Error('[storage-state] a non-empty roleKey string is required');
  }
  return path.join(AUTH_DIR, `${roleKey}.json`);
}

/**
 * Ensure the cache directory (`.auth/`) exists. Idempotent.
 * @returns {string} The absolute AUTH_DIR path.
 */
function ensureAuthDir() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  return AUTH_DIR;
}

/**
 * Whether a non-empty, non-expired storage-state file exists for the role.
 * @param {string} roleKey
 * @param {number} [maxAgeMs=DEFAULT_MAX_AGE_MS]
 * @returns {boolean}
 */
function hasFreshStorageState(roleKey, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const file = storageStatePath(roleKey);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (err) {
    return false; // missing
  }
  if (!stat.isFile() || stat.size === 0) {
    return false; // empty / not a file
  }
  const ageMs = Date.now() - stat.mtimeMs;
  return ageMs >= 0 && ageMs < maxAgeMs;
}

/**
 * Delete a role's cached storage state if present (best-effort). Useful to
 * force a fresh login.
 * @param {string} roleKey
 * @returns {void}
 */
function clearStorageState(roleKey) {
  try {
    fs.rmSync(storageStatePath(roleKey), { force: true });
  } catch (err) {
    // best-effort — ignore
  }
}

/**
 * Delete ALL cached storage states (best-effort).
 * @returns {void}
 */
function clearAllStorageState() {
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  } catch (err) {
    // best-effort — ignore
  }
}

/**
 * Name of the environment variable that may hold a role's MFA one-time code,
 * derived from the credential's `envEmailVar` (e.g. `TEST_ADMIN_EMAIL` ->
 * `TEST_ADMIN_MFA_CODE`). Falls back to a `TEST_<KEY>` prefix.
 * @param {{envEmailVar?: string, key?: string}} credential
 * @returns {string}
 */
function mfaEnvVarName(credential) {
  const prefix =
    credential && credential.envEmailVar
      ? String(credential.envEmailVar).replace(/_EMAIL$/, '')
      : `TEST_${String((credential && credential.key) || '').toUpperCase()}`;
  return `${prefix}_MFA_CODE`;
}

/**
 * Resolve the MFA one-time code for a role from the environment (SYNTHETIC /
 * dev-only). Checks the role-specific var first, then the shared fallbacks.
 * Returns `undefined` when none is set (non-MFA roles, or MFA disabled/bypassed
 * in the seeded environment) — in which case the Login POM skips the MFA step.
 * @param {{envEmailVar?: string, key?: string}} credential
 * @returns {string|undefined}
 */
function getMfaCode(credential) {
  const specific = process.env[mfaEnvVarName(credential)];
  return (
    specific ||
    process.env.TEST_DEFAULT_MFA_CODE ||
    process.env.TEST_MFA_CODE ||
    undefined
  );
}

module.exports = {
  AUTH_DIR,
  DEFAULT_MAX_AGE_MS,
  storageStatePath,
  ensureAuthDir,
  hasFreshStorageState,
  clearStorageState,
  clearAllStorageState,
  mfaEnvVarName,
  getMfaCode,
};
